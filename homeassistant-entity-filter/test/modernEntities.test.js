import test from "node:test";
import assert from "node:assert/strict";
import { ModernEntitiesManager } from "../src/modernEntities.js";

const ENTITY_ID = "sensor.home_temperature.living";

class ManualScheduler {
  constructor() {
    this.currentTime = 0;
    this.jobs = [];
    this.nextId = 1;
  }

  now = () => this.currentTime;

  setTimeout = (fn, delay) => {
    const job = {
      id: this.nextId,
      time: this.currentTime + delay,
      fn,
      cancelled: false,
    };
    this.nextId += 1;
    this.jobs.push(job);
    return job.id;
  };

  clearTimeout = (jobId) => {
    const job = this.jobs.find((entry) => entry.id === jobId);
    if (job) {
      job.cancelled = true;
    }
  };

  advance(ms) {
    this.currentTime += ms;
    let ranWork = true;
    while (ranWork) {
      ranWork = false;
      this.jobs.sort((left, right) => left.time - right.time || left.id - right.id);
      for (const job of this.jobs) {
        if (!job.cancelled && job.time <= this.currentTime) {
          job.cancelled = true;
          job.fn();
          ranWork = true;
          break;
        }
      }
    }
  }
}

test("ModernEntitiesManager filters initial snapshots and flushes the latest throttled update", () => {
  const scheduler = new ManualScheduler();
  const emitted = [];
  const manager = new ModernEntitiesManager({
    resolvePolicy: (entityId) => {
      if (entityId === ENTITY_ID) {
        return { action: "allow", rateLimitMs: 1000 };
      }
      return { action: "deny", rateLimitMs: null };
    },
    emitMessages: (messages) => emitted.push(messages),
    scheduler,
  });

  manager.trackSubscription(1);

  const initial = manager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      a: {
        [ENTITY_ID]: { s: "10", a: { unit_of_measurement: "C" }, c: "ctx-1", lc: 1 },
        "camera.porch": { s: "idle", a: {}, c: "ctx-2", lc: 1 },
      },
      c: {},
    },
  });

  assert.deepEqual(Object.keys(initial[0].event.a), [ENTITY_ID]);

  const immediate = manager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "11", lc: 2 } },
      },
    },
  });

  assert.equal(immediate.length, 1);
  assert.equal(immediate[0].event.c[ENTITY_ID]["+"].s, "11");

  const delayed = manager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "12", lc: 3 } },
      },
    },
  });

  assert.deepEqual(delayed, []);

  scheduler.advance(1000);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0].event.c[ENTITY_ID]["+"].s, "12");
});

test("ModernEntitiesManager flushes removals after the rate window reopens", () => {
  const scheduler = new ManualScheduler();
  const emitted = [];
  const manager = new ModernEntitiesManager({
    resolvePolicy: (entityId) => ({
      action: entityId === ENTITY_ID ? "allow" : "deny",
      rateLimitMs: entityId === ENTITY_ID ? 1000 : null,
    }),
    emitMessages: (messages) => emitted.push(messages),
    scheduler,
  });

  manager.trackSubscription(2);
  manager.handleServerMessage({
    id: 2,
    type: "event",
    event: {
      a: {
        [ENTITY_ID]: { s: "10", a: {}, c: "ctx-1", lc: 1 },
      },
      c: {},
    },
  });

  manager.handleServerMessage({
    id: 2,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "11", lc: 2 } },
      },
    },
  });

  const delayedRemove = manager.handleServerMessage({
    id: 2,
    type: "event",
    event: {
      r: [ENTITY_ID],
      c: {},
    },
  });

  assert.deepEqual(delayedRemove, []);

  scheduler.advance(1000);
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0][0].event.r, [ENTITY_ID]);
});

test("ModernEntitiesManager records only allowed post-snapshot updates", () => {
  const scheduler = new ManualScheduler();
  const recorded = [];
  const manager = new ModernEntitiesManager({
    resolvePolicy: (entityId) => {
      if (entityId === ENTITY_ID) {
        return { action: "allow", rateLimitMs: 1000 };
      }
      return { action: "deny", rateLimitMs: null };
    },
    emitMessages: () => {},
    entityUpdateRateMonitor: {
      record(entityId, timestamp) {
        recorded.push({ entityId, timestamp });
      },
    },
    scheduler,
  });

  manager.trackSubscription(3);

  manager.handleServerMessage({
    id: 3,
    type: "event",
    event: {
      a: {
        [ENTITY_ID]: { s: "10", a: {}, c: "ctx-1", lc: 1 },
        "camera.porch": { s: "idle", a: {}, c: "ctx-2", lc: 1 },
      },
      c: {},
    },
  });

  assert.deepEqual(recorded, []);

  manager.handleServerMessage({
    id: 3,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "11", lc: 2 } },
        "camera.porch": { "+": { s: "busy", lc: 2 } },
      },
    },
  });

  manager.handleServerMessage({
    id: 3,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "12", lc: 3 } },
      },
    },
  });

  assert.deepEqual(recorded, [
    { entityId: ENTITY_ID, timestamp: 0 },
    { entityId: ENTITY_ID, timestamp: 0 },
  ]);
});

test("ModernEntitiesManager records forwarded, filtered, and superseded throttled entity updates", async () => {
  const scheduler = new ManualScheduler();
  const summaryReporter = createSummaryReporter();
  const manager = new ModernEntitiesManager({
    resolvePolicy: (entityId) => {
      if (entityId === ENTITY_ID) {
        return { action: "allow", rateLimitMs: 1000 };
      }
      return { action: "deny", rateLimitMs: null };
    },
    emitMessages: () => {},
    eventSummaryReporter: summaryReporter,
    scheduler,
  });

  manager.trackSubscription(4);

  const initial = manager.handleServerMessage({
    id: 4,
    type: "event",
    event: {
      a: {
        [ENTITY_ID]: { s: "10", a: {}, c: "ctx-1", lc: 1 },
        "camera.porch": { s: "idle", a: {}, c: "ctx-2", lc: 1 },
      },
      c: {},
    },
  });

  assert.equal(initial.length, 1);
  assert.equal(summaryReporter.forwarded, 1);
  assert.equal(summaryReporter.filtered, 1);
  assert.equal(summaryReporter.rateLimitedDropped, 0);

  const immediate = manager.handleServerMessage({
    id: 4,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "11", lc: 2 } },
        "camera.porch": { "+": { s: "busy", lc: 2 } },
      },
    },
  });

  assert.equal(immediate.length, 1);
  assert.equal(summaryReporter.forwarded, 2);
  assert.equal(summaryReporter.filtered, 2);
  assert.equal(summaryReporter.rateLimitedDropped, 0);

  manager.handleServerMessage({
    id: 4,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "12", lc: 3 } },
      },
    },
  });

  assert.equal(summaryReporter.rateLimitedDropped, 0);

  const superseding = manager.handleServerMessage({
    id: 4,
    type: "event",
    event: {
      c: {
        [ENTITY_ID]: { "+": { s: "13", lc: 4 } },
      },
    },
  });

  assert.deepEqual(superseding, []);
  assert.equal(summaryReporter.rateLimitedDropped, 1);

  scheduler.advance(1000);
  await Promise.resolve();

  assert.equal(summaryReporter.forwarded, 3);
});

function createSummaryReporter() {
  return {
    forwarded: 0,
    filtered: 0,
    rateLimitedDropped: 0,
    recordForwarded(count = 1) {
      this.forwarded += count;
    },
    recordFiltered(count = 1) {
      this.filtered += count;
    },
    recordRateLimitedDropped(count = 1) {
      this.rateLimitedDropped += count;
    },
  };
}
