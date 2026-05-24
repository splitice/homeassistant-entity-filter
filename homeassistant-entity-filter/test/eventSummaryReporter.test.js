import test from "node:test";
import assert from "node:assert/strict";
import { EventSummaryReporter } from "../src/eventSummaryReporter.js";
import { LegacyStateChangedManager } from "../src/legacyStateChanged.js";
import { ModernEntitiesManager } from "../src/modernEntities.js";

const ENTITY_ID = "sensor.noisy";

class ManualTimer {
  constructor() {
    this.currentTime = 0;
    this.jobs = [];
    this.nextId = 1;
  }

  now = () => this.currentTime;

  setTimeout = (fn, delay) => {
    return this._schedule("timeout", fn, delay);
  };

  clearTimeout = (jobId) => {
    const job = this.jobs.find((entry) => entry.id === jobId);
    if (job) {
      job.cancelled = true;
    }
  };

  setInterval = (fn, delay) => {
    return this._schedule("interval", fn, delay);
  };

  clearInterval = (jobId) => {
    this.clearTimeout(jobId);
  };

  advance(ms) {
    this.currentTime += ms;
    let ranWork = true;
    while (ranWork) {
      ranWork = false;
      this.jobs.sort((left, right) => left.time - right.time || left.id - right.id);
      for (const job of this.jobs) {
        if (job.cancelled || job.time > this.currentTime) {
          continue;
        }

        if (job.type === "interval") {
          job.time += job.delay;
        } else {
          job.cancelled = true;
        }
        job.fn();
        ranWork = true;
        break;
      }
    }
  }

  _schedule(type, fn, delay) {
    const job = {
      id: this.nextId,
      type,
      time: this.currentTime + delay,
      delay,
      fn,
      cancelled: false,
    };
    this.nextId += 1;
    this.jobs.push(job);
    return job.id;
  }
}

test("EventSummaryReporter logs one summary line per interval with current counts", () => {
  const scheduler = new ManualTimer();
  const logger = createLogger();
  const reporter = new EventSummaryReporter({
    logger,
    scheduler,
  });

  reporter.recordForwarded(3);
  reporter.recordFiltered(2);
  reporter.recordRateLimitedDropped(1);

  scheduler.advance(299999);
  assert.deepEqual(logger.infos, []);

  scheduler.advance(1);
  assert.deepEqual(logger.infos, [
    "event summary (last 5m): forwarded=3 filtered=2 rate_limited_dropped=1",
  ]);

  reporter.close();
});

test("EventSummaryReporter resets counts after each summary line", () => {
  const scheduler = new ManualTimer();
  const logger = createLogger();
  const reporter = new EventSummaryReporter({
    logger,
    scheduler,
  });

  reporter.recordForwarded(2);

  scheduler.advance(300000);
  reporter.recordFiltered(4);
  scheduler.advance(300000);

  assert.deepEqual(logger.infos, [
    "event summary (last 5m): forwarded=2 filtered=0 rate_limited_dropped=0",
    "event summary (last 5m): forwarded=0 filtered=4 rate_limited_dropped=0",
  ]);

  reporter.close();
});

test("EventSummaryReporter logs zero counts when no activity occurred", () => {
  const scheduler = new ManualTimer();
  const logger = createLogger();
  const reporter = new EventSummaryReporter({
    logger,
    scheduler,
  });

  scheduler.advance(300000);

  assert.deepEqual(logger.infos, [
    "event summary (last 5m): forwarded=0 filtered=0 rate_limited_dropped=0",
  ]);

  reporter.close();
});

test("EventSummaryReporter close stops future interval logs", () => {
  const scheduler = new ManualTimer();
  const logger = createLogger();
  const reporter = new EventSummaryReporter({
    logger,
    scheduler,
  });

  reporter.recordForwarded(1);
  reporter.close();
  scheduler.advance(600000);

  assert.deepEqual(logger.infos, []);
});

test("EventSummaryReporter aggregates counts across legacy and modern managers", async () => {
  const workTimer = new ManualTimer();
  const reporterTimer = new ManualTimer();
  const logger = createLogger();
  const reporter = new EventSummaryReporter({
    logger,
    scheduler: reporterTimer,
  });
  const modernManager = new ModernEntitiesManager({
    resolvePolicy: (entityId) => ({
      action: entityId === ENTITY_ID ? "allow" : "deny",
      rateLimitMs: entityId === ENTITY_ID ? 1000 : null,
    }),
    emitMessages: () => {},
    eventSummaryReporter: reporter,
    scheduler: workTimer,
  });
  const legacyManager = new LegacyStateChangedManager({
    resolvePolicy: (entityId) => ({
      action: entityId === ENTITY_ID ? "allow" : "deny",
      rateLimitMs: null,
    }),
    emitMessages: () => {},
    eventSummaryReporter: reporter,
    scheduler: workTimer,
  });

  modernManager.trackSubscription(1);
  modernManager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      a: {
        [ENTITY_ID]: { s: "10", a: {}, c: "ctx-1", lc: 1 },
        "camera.porch": { s: "idle", a: {}, c: "ctx-2", lc: 1 },
      },
      c: {},
    },
  });
  modernManager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "11", lc: 2 } },
      },
    },
  });
  modernManager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "12", lc: 3 } },
      },
    },
  });
  modernManager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "13", lc: 4 } },
      },
    },
  });

  legacyManager.trackSubscription(2);
  legacyManager.handleServerMessage(buildLegacyMessage(2, ENTITY_ID, "20"));
  legacyManager.handleServerMessage(buildLegacyMessage(2, "sensor.blocked", "1"));

  workTimer.advance(1000);
  await Promise.resolve();

  reporterTimer.advance(300000);

  assert.deepEqual(logger.infos, [
    "event summary (last 5m): forwarded=4 filtered=2 rate_limited_dropped=1",
  ]);

  reporter.close();
});

function buildLegacyMessage(id, entityId, state) {
  return {
    id,
    type: "event",
    event: {
      event_type: "state_changed",
      data: {
        entity_id: entityId,
        new_state: {
          entity_id: entityId,
          state,
        },
      },
    },
  };
}

function createLogger() {
  const infos = [];
  return {
    infos,
    info(message) {
      infos.push(message);
    },
  };
}
