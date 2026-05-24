import test from "node:test";
import assert from "node:assert/strict";
import { EntityUpdateRateMonitor } from "../src/entityUpdateRateMonitor.js";
import { LegacyStateChangedManager } from "../src/legacyStateChanged.js";
import { ModernEntitiesManager } from "../src/modernEntities.js";

const ENTITY_ID = "sensor.noisy";

class ManualClock {
  constructor() {
    this.currentTime = 0;
  }

  now = () => this.currentTime;

  set(time) {
    this.currentTime = time;
  }
}

function createLogger() {
  const warnings = [];
  return {
    warnings,
    warn(message) {
      warnings.push(message);
    },
  };
}

test("EntityUpdateRateMonitor does not warn below threshold", () => {
  const clock = new ManualClock();
  const logger = createLogger();
  const monitor = new EntityUpdateRateMonitor({
    thresholdPerMinute: 2,
    logger,
    clock: clock.now,
  });

  for (let index = 0; index < 5; index += 1) {
    clock.set(index * 1000);
    monitor.record(ENTITY_ID);
  }

  assert.deepEqual(logger.warnings, []);
});

test("EntityUpdateRateMonitor does not warn at the exact threshold", () => {
  const clock = new ManualClock();
  const logger = createLogger();
  const monitor = new EntityUpdateRateMonitor({
    thresholdPerMinute: 2,
    logger,
    clock: clock.now,
  });

  for (let index = 0; index < 6; index += 1) {
    clock.set(index * 1000);
    monitor.record(ENTITY_ID);
  }

  assert.deepEqual(logger.warnings, []);
});

test("EntityUpdateRateMonitor warns once when the average exceeds the threshold", () => {
  const clock = new ManualClock();
  const logger = createLogger();
  const monitor = new EntityUpdateRateMonitor({
    thresholdPerMinute: 2,
    logger,
    clock: clock.now,
  });

  for (let index = 0; index < 7; index += 1) {
    clock.set(index * 1000);
    monitor.record(ENTITY_ID);
  }

  assert.equal(logger.warnings.length, 1);
  assert.match(logger.warnings[0], /sensor\.noisy averaged 2\.33\/min over the last 3m/);
  assert.match(logger.warnings[0], /threshold 2\.00\/min/);
});

test("EntityUpdateRateMonitor warns only once per entity for the process lifetime", () => {
  const clock = new ManualClock();
  const logger = createLogger();
  const monitor = new EntityUpdateRateMonitor({
    thresholdPerMinute: 2,
    logger,
    clock: clock.now,
  });

  for (let index = 0; index < 7; index += 1) {
    clock.set(index * 1000);
    monitor.record(ENTITY_ID);
  }

  clock.set(300000);
  monitor.record(ENTITY_ID);
  monitor.record(ENTITY_ID);

  assert.equal(logger.warnings.length, 1);
});

test("EntityUpdateRateMonitor prunes expired timestamps before recomputing the average", () => {
  const clock = new ManualClock();
  const logger = createLogger();
  const monitor = new EntityUpdateRateMonitor({
    thresholdPerMinute: 2,
    logger,
    clock: clock.now,
  });

  for (let index = 0; index < 6; index += 1) {
    clock.set(index * 1000);
    monitor.record(ENTITY_ID);
  }

  clock.set(360001);
  monitor.record(ENTITY_ID);

  assert.deepEqual(logger.warnings, []);
});

test("EntityUpdateRateMonitor disables warnings when the threshold is zero", () => {
  const clock = new ManualClock();
  const logger = createLogger();
  const monitor = new EntityUpdateRateMonitor({
    thresholdPerMinute: 0,
    logger,
    clock: clock.now,
  });

  for (let index = 0; index < 20; index += 1) {
    clock.set(index * 1000);
    monitor.record(ENTITY_ID);
  }

  assert.deepEqual(logger.warnings, []);
  assert.equal(monitor.entityTimestamps.size, 0);
});

test("shared monitor aggregates counts across managers and warns only once", () => {
  const clock = new ManualClock();
  const logger = createLogger();
  const monitor = new EntityUpdateRateMonitor({
    thresholdPerMinute: 2,
    logger,
    clock: clock.now,
  });
  const scheduler = {
    now: clock.now,
    setTimeout() {
      throw new Error("setTimeout should not be called in this test");
    },
    clearTimeout() {},
  };
  const modernManager = new ModernEntitiesManager({
    resolvePolicy: (entityId) => ({
      action: entityId === ENTITY_ID ? "allow" : "deny",
      rateLimitMs: null,
    }),
    emitMessages: () => {},
    entityUpdateRateMonitor: monitor,
    scheduler,
  });
  const legacyManager = new LegacyStateChangedManager({
    resolvePolicy: (entityId) => ({
      action: entityId === ENTITY_ID ? "allow" : "deny",
      rateLimitMs: null,
    }),
    emitMessages: () => {},
    entityUpdateRateMonitor: monitor,
    scheduler,
  });

  modernManager.trackSubscription(1);
  modernManager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      a: {
        [ENTITY_ID]: { s: "10", a: {}, c: "ctx-1", lc: 1 },
      },
      c: {},
    },
  });

  for (let index = 0; index < 4; index += 1) {
    clock.set(index * 1000);
    modernManager.handleServerMessage({
      id: 1,
      type: "event",
      event: {
        c: {
          [ENTITY_ID]: { "+": { s: String(11 + index), lc: 2 + index } },
        },
      },
    });
  }

  legacyManager.trackSubscription(2);
  for (let index = 0; index < 3; index += 1) {
    clock.set((index + 4) * 1000);
    legacyManager.handleServerMessage(buildLegacyMessage(2, ENTITY_ID, String(20 + index)));
  }

  assert.equal(logger.warnings.length, 1);

  clock.set(10000);
  legacyManager.handleServerMessage(buildLegacyMessage(2, ENTITY_ID, "30"));
  assert.equal(logger.warnings.length, 1);
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
