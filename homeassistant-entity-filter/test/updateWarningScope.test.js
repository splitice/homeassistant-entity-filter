import test from "node:test";
import assert from "node:assert/strict";
import { RuleEngine } from "../src/ruleEngine.js";
import { ModernEntitiesManager } from "../src/modernEntities.js";
import { LegacyStateChangedManager } from "../src/legacyStateChanged.js";

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
}

test("RuleEngine marks only explicit rule matches as explicit", () => {
  const engine = new RuleEngine(
    [
      {
        name: "explicit allow",
        match_type: "exact",
        match: "sensor.explicit",
        action: "allow",
      },
    ],
    "allow",
  );

  assert.equal(engine.resolve("sensor.explicit").matchedExplicitRule, true);
  assert.equal(
    engine.resolve("sensor.required", new Set(["sensor.required"])).matchedExplicitRule,
    false,
  );
  assert.equal(engine.resolve("sensor.default").matchedExplicitRule, false);
});

test("ModernEntitiesManager warning telemetry ignores explicit-rule matches", () => {
  const scheduler = new ManualScheduler();
  const recorded = [];
  const manager = new ModernEntitiesManager({
    resolvePolicy: (entityId) => ({
      action: "allow",
      rateLimitMs: null,
      matchedExplicitRule: entityId === "sensor.explicit",
    }),
    emitMessages: () => {},
    entityUpdateRateMonitor: {
      record(entityId, timestamp) {
        recorded.push({ entityId, timestamp });
      },
    },
    scheduler,
  });

  manager.trackSubscription(1);
  manager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      a: {
        "sensor.explicit": { s: "10", a: {}, c: "ctx-1", lc: 1 },
        "sensor.default": { s: "20", a: {}, c: "ctx-2", lc: 1 },
      },
      c: {},
    },
  });

  manager.handleServerMessage({
    id: 1,
    type: "event",
    event: {
      c: {
        "sensor.explicit": { "+": { s: "11", lc: 2 } },
        "sensor.default": { "+": { s: "21", lc: 2 } },
      },
    },
  });

  assert.deepEqual(recorded, [{ entityId: "sensor.default", timestamp: 0 }]);
});

test("LegacyStateChangedManager warning telemetry ignores explicit-rule matches", () => {
  const scheduler = new ManualScheduler();
  const recorded = [];
  const manager = new LegacyStateChangedManager({
    resolvePolicy: (entityId) => ({
      action: "allow",
      rateLimitMs: null,
      matchedExplicitRule: entityId === "sensor.explicit",
    }),
    emitMessages: () => {},
    entityUpdateRateMonitor: {
      record(entityId, timestamp) {
        recorded.push({ entityId, timestamp });
      },
    },
    scheduler,
  });

  manager.trackSubscription(7);
  manager.handleServerMessage(buildLegacyMessage(7, "sensor.explicit", "10"));
  manager.handleServerMessage(buildLegacyMessage(7, "sensor.default", "20"));

  assert.deepEqual(recorded, [{ entityId: "sensor.default", timestamp: 0 }]);
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
