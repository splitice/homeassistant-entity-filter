import test from "node:test";
import assert from "node:assert/strict";
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

test("LegacyStateChangedManager rate limits and flushes only the latest event", () => {
  const scheduler = new ManualScheduler();
  const emitted = [];
  const manager = new LegacyStateChangedManager({
    resolvePolicy: (entityId) => ({
      action: entityId === "sensor.room_temp" ? "allow" : "deny",
      rateLimitMs: entityId === "sensor.room_temp" ? 1000 : null,
    }),
    emitMessages: (messages) => emitted.push(messages),
    scheduler,
  });

  manager.trackSubscription(7);

  const first = manager.handleServerMessage(buildMessage(7, "sensor.room_temp", "10"));
  assert.equal(first.length, 1);
  assert.equal(first[0].event.data.new_state.state, "10");

  const second = manager.handleServerMessage(buildMessage(7, "sensor.room_temp", "11"));
  const third = manager.handleServerMessage(buildMessage(7, "sensor.room_temp", "12"));

  assert.deepEqual(second, []);
  assert.deepEqual(third, []);

  scheduler.advance(1000);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].length, 1);
  assert.equal(emitted[0][0].event.data.new_state.state, "12");
});

test("LegacyStateChangedManager leaves untracked subscriptions untouched", () => {
  const manager = new LegacyStateChangedManager({
    resolvePolicy: () => ({ action: "allow", rateLimitMs: null }),
    emitMessages: () => {},
  });

  assert.equal(manager.handleServerMessage(buildMessage(99, "sensor.any", "1")), null);
});

test("LegacyStateChangedManager records allowed updates before rate limiting", () => {
  const scheduler = new ManualScheduler();
  const recorded = [];
  const manager = new LegacyStateChangedManager({
    resolvePolicy: (entityId) => ({
      action: entityId === "sensor.room_temp" ? "allow" : "deny",
      rateLimitMs: entityId === "sensor.room_temp" ? 1000 : null,
    }),
    emitMessages: () => {},
    entityUpdateRateMonitor: {
      record(entityId, timestamp) {
        recorded.push({ entityId, timestamp });
      },
    },
    scheduler,
  });

  manager.trackSubscription(8);

  manager.handleServerMessage(buildMessage(8, "sensor.room_temp", "10"));
  manager.handleServerMessage(buildMessage(8, "sensor.room_temp", "11"));
  manager.handleServerMessage(buildMessage(8, "sensor.other", "1"));

  assert.deepEqual(recorded, [
    { entityId: "sensor.room_temp", timestamp: 0 },
    { entityId: "sensor.room_temp", timestamp: 0 },
  ]);
});

function buildMessage(id, entityId, state) {
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
