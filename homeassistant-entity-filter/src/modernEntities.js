import { isDeepStrictEqual } from "node:util";

export class ModernEntitiesManager {
  constructor({
    resolvePolicy,
    emitMessages,
    entityUpdateRateMonitor = null,
    eventSummaryReporter = null,
    scheduler = defaultScheduler,
    logger = console,
  }) {
    this.resolvePolicy = resolvePolicy;
    this.emitMessages = emitMessages;
    this.entityUpdateRateMonitor = entityUpdateRateMonitor;
    this.eventSummaryReporter = eventSummaryReporter;
    this.scheduler = scheduler;
    this.logger = logger;
    this.subscriptions = new Map();
  }

  trackSubscription(subscriptionId) {
    const id = normalizeSubscriptionId(subscriptionId);
    if (id == null) {
      return;
    }
    if (!this.subscriptions.has(id)) {
      this.subscriptions.set(id, createSubscription(id));
    }
  }

  clearSubscription(subscriptionId) {
    const id = normalizeSubscriptionId(subscriptionId);
    if (id == null) {
      return;
    }
    const subscription = this.subscriptions.get(id);
    if (!subscription) {
      return;
    }
    if (subscription.timer) {
      this.scheduler.clearTimeout(subscription.timer);
    }
    this.subscriptions.delete(id);
  }

  close() {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.timer) {
        this.scheduler.clearTimeout(subscription.timer);
      }
    }
    this.subscriptions.clear();
  }

  handleServerMessage(message) {
    const subscriptionId = normalizeSubscriptionId(message?.id);
    if (subscriptionId == null || !this.subscriptions.has(subscriptionId)) {
      return null;
    }

    const subscription = this.subscriptions.get(subscriptionId);
    if (message.type === "result" && message.success === false) {
      this.clearSubscription(subscriptionId);
      return [message];
    }

    if (message.type !== "event" || !message.event || typeof message.event !== "object") {
      return [message];
    }

    return this._handleEvent(subscription, message);
  }

  _handleEvent(subscription, message) {
    const resolvePolicy = createPolicyResolver((entityId) => this.resolvePolicy(entityId));
    const filteredCount = countFilteredEntityOccurrences(message.event, resolvePolicy);
    if (filteredCount > 0) {
      this.eventSummaryReporter?.recordFiltered(filteredCount);
    }

    if (!subscription.initialSnapshotSeen) {
      const filteredState = new Map();
      applyStatesUpdates(filteredState, message.event, (entityId) => {
        return resolvePolicy(entityId).action === "allow";
      });
      subscription.currentState = filteredState;
      subscription.sentState = cloneStateMap(filteredState);
      subscription.initialSnapshotSeen = true;
      const outgoingEvent = buildSnapshotUpdates(filteredState);
      this.eventSummaryReporter?.recordForwarded(countEntityUpdates(outgoingEvent));
      return [{ ...message, event: outgoingEvent }];
    }

    const changedEntities = applyStatesUpdates(subscription.currentState, message.event, (entityId) => {
      return resolvePolicy(entityId).action === "allow";
    });

    const outgoingUpdates = createEmptyUpdates();
    const now = this.scheduler.now();

    for (const entityId of changedEntities) {
      const policy = resolvePolicy(entityId);
      if (policy.action !== "allow") {
        continue;
      }
      if (policy.matchedExplicitRule !== true) {
        this.entityUpdateRateMonitor?.record(entityId, now);
      }

      const rateLimitMs = policy.rateLimitMs ?? null;
      if (!rateLimitMs) {
        const changed = appendEntityChange(
          outgoingUpdates,
          entityId,
          subscription.sentState.get(entityId),
          subscription.currentState.get(entityId),
        );
        if (changed) {
          syncStateMapEntry(subscription.sentState, subscription.currentState, entityId);
        }
        continue;
      }

      const slot = ensureEntitySlot(subscription, entityId, rateLimitMs);
      if (!slot.pending && now >= slot.nextAllowedAt) {
        const changed = appendEntityChange(
          outgoingUpdates,
          entityId,
          subscription.sentState.get(entityId),
          subscription.currentState.get(entityId),
        );
        if (changed) {
          syncStateMapEntry(subscription.sentState, subscription.currentState, entityId);
          slot.nextAllowedAt = now + rateLimitMs;
        } else {
          slot.nextAllowedAt = now;
        }
      } else {
        if (slot.pending) {
          this.eventSummaryReporter?.recordRateLimitedDropped(1);
        }
        slot.pending = true;
      }
    }

    this._scheduleFlush(subscription);

    if (!hasUpdates(outgoingUpdates)) {
      return [];
    }

    const outgoingEvent = normalizeUpdatesShape(outgoingUpdates);
    this.eventSummaryReporter?.recordForwarded(countEntityUpdates(outgoingEvent));
    return [{ ...message, event: outgoingEvent }];
  }

  _scheduleFlush(subscription) {
    if (subscription.timer) {
      this.scheduler.clearTimeout(subscription.timer);
      subscription.timer = null;
    }

    let nextDueAt = Infinity;
    for (const slot of subscription.entities.values()) {
      if (slot.pending) {
        nextDueAt = Math.min(nextDueAt, slot.nextAllowedAt);
      }
    }

    if (!Number.isFinite(nextDueAt)) {
      return;
    }

    const delay = Math.max(0, nextDueAt - this.scheduler.now());
    subscription.timer = this.scheduler.setTimeout(() => {
      subscription.timer = null;
      this._flushSubscription(subscription.id);
    }, delay);
  }

  _flushSubscription(subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }

    const outgoingUpdates = createEmptyUpdates();
    const now = this.scheduler.now();

    for (const [entityId, slot] of subscription.entities) {
      if (!slot.pending || slot.nextAllowedAt > now) {
        continue;
      }

      const changed = appendEntityChange(
        outgoingUpdates,
        entityId,
        subscription.sentState.get(entityId),
        subscription.currentState.get(entityId),
      );
      slot.pending = false;
      if (changed) {
        syncStateMapEntry(subscription.sentState, subscription.currentState, entityId);
        slot.nextAllowedAt = now + slot.rateLimitMs;
      } else {
        slot.nextAllowedAt = now;
      }
    }

    if (hasUpdates(outgoingUpdates)) {
      const outgoingEvent = normalizeUpdatesShape(outgoingUpdates);
      const forwardedCount = countEntityUpdates(outgoingEvent);
      try {
        const emitResult = this.emitMessages([
          {
            id: subscription.id,
            type: "event",
            event: outgoingEvent,
          },
        ]);
        Promise.resolve(emitResult)
          .then(() => {
            this.eventSummaryReporter?.recordForwarded(forwardedCount);
          })
          .catch((error) => {
            this.logger.error(`modern flush failed for subscription ${subscription.id}: ${error.message}`);
          });
      } catch (error) {
        this.logger.error(`modern flush failed for subscription ${subscription.id}: ${error.message}`);
      }
    }

    this._scheduleFlush(subscription);
  }
}

export function applyStatesUpdates(stateMap, updates, shouldTrackEntity = () => true) {
  const changedEntities = new Set();

  if (updates?.a && typeof updates.a === "object") {
    for (const [entityId, entityState] of Object.entries(updates.a)) {
      if (!shouldTrackEntity(entityId)) {
        continue;
      }
      stateMap.set(entityId, canonicalizeEntityState(entityState));
      changedEntities.add(entityId);
    }
  }

  if (Array.isArray(updates?.r)) {
    for (const entityId of updates.r) {
      if (!shouldTrackEntity(entityId)) {
        continue;
      }
      if (stateMap.delete(entityId)) {
        changedEntities.add(entityId);
      }
    }
  }

  if (updates?.c && typeof updates.c === "object") {
    for (const [entityId, entityDiff] of Object.entries(updates.c)) {
      if (!shouldTrackEntity(entityId)) {
        continue;
      }
      if (applyEntityDiff(stateMap, entityId, entityDiff)) {
        changedEntities.add(entityId);
      }
    }
  }

  return changedEntities;
}

export function appendEntityChange(updates, entityId, previousState, nextState) {
  if (!previousState && !nextState) {
    return false;
  }

  if (!previousState && nextState) {
    updates.a ??= {};
    updates.a[entityId] = cloneEntityState(nextState);
    return true;
  }

  if (previousState && !nextState) {
    updates.r ??= [];
    updates.r.push(entityId);
    return true;
  }

  const plus = {};
  const minus = {};

  if (!Object.is(previousState.s, nextState.s)) {
    plus.s = nextState.s;
  }
  if (!isDeepStrictEqual(previousState.c, nextState.c)) {
    plus.c = cloneLoose(nextState.c);
  }
  if (!Object.is(previousState.lc, nextState.lc)) {
    plus.lc = nextState.lc;
    plus.lu = nextState.lu;
  } else if (!Object.is(previousState.lu, nextState.lu)) {
    plus.lu = nextState.lu;
  }

  const previousAttributes = previousState.a ?? {};
  const nextAttributes = nextState.a ?? {};
  const attrAdds = {};
  const attrRemovals = [];
  const attributeKeys = new Set([
    ...Object.keys(previousAttributes),
    ...Object.keys(nextAttributes),
  ]);

  for (const key of attributeKeys) {
    if (!(key in nextAttributes)) {
      attrRemovals.push(key);
      continue;
    }
    if (!isDeepStrictEqual(previousAttributes[key], nextAttributes[key])) {
      attrAdds[key] = cloneLoose(nextAttributes[key]);
    }
  }

  if (Object.keys(attrAdds).length > 0) {
    plus.a = attrAdds;
  }
  if (attrRemovals.length > 0) {
    minus.a = attrRemovals;
  }

  if (!Object.keys(plus).length && !Object.keys(minus).length) {
    return false;
  }

  updates.c ??= {};
  updates.c[entityId] = {};
  if (Object.keys(plus).length) {
    updates.c[entityId]["+"] = plus;
  }
  if (Object.keys(minus).length) {
    updates.c[entityId]["-"] = minus;
  }
  return true;
}

export function buildSnapshotUpdates(stateMap) {
  return {
    a: Object.fromEntries(
      [...stateMap.entries()].map(([entityId, entityState]) => [entityId, cloneEntityState(entityState)]),
    ),
    c: {},
  };
}

export function normalizeUpdatesShape(updates) {
  return {
    ...(updates.a && Object.keys(updates.a).length ? { a: updates.a } : {}),
    ...(updates.r && updates.r.length ? { r: updates.r } : {}),
    c: updates.c && Object.keys(updates.c).length ? updates.c : {},
  };
}

export function hasUpdates(updates) {
  return Boolean(
    (updates.a && Object.keys(updates.a).length) ||
      (updates.r && updates.r.length) ||
      (updates.c && Object.keys(updates.c).length),
  );
}

function createSubscription(id) {
  return {
    id,
    initialSnapshotSeen: false,
    currentState: new Map(),
    sentState: new Map(),
    entities: new Map(),
    timer: null,
  };
}

function ensureEntitySlot(subscription, entityId, rateLimitMs) {
  let slot = subscription.entities.get(entityId);
  if (!slot) {
    slot = {
      nextAllowedAt: 0,
      pending: false,
      rateLimitMs,
    };
    subscription.entities.set(entityId, slot);
  }
  slot.rateLimitMs = rateLimitMs;
  return slot;
}

function applyEntityDiff(stateMap, entityId, entityDiff) {
  const current = stateMap.get(entityId);
  if (!current) {
    return false;
  }

  const nextState = cloneEntityState(current);
  const additions = entityDiff?.["+"] ?? {};
  const removals = entityDiff?.["-"] ?? {};

  if (Object.prototype.hasOwnProperty.call(additions, "s")) {
    nextState.s = additions.s;
  }
  if (Object.prototype.hasOwnProperty.call(additions, "c")) {
    nextState.c = cloneLoose(additions.c);
  }
  if (Object.prototype.hasOwnProperty.call(additions, "lc")) {
    nextState.lc = additions.lc;
    nextState.lu = Object.prototype.hasOwnProperty.call(additions, "lu")
      ? additions.lu
      : additions.lc;
  } else if (Object.prototype.hasOwnProperty.call(additions, "lu")) {
    nextState.lu = additions.lu;
  }
  if (additions.a && typeof additions.a === "object") {
    nextState.a = {
      ...nextState.a,
      ...cloneLoose(additions.a),
    };
  }
  if (Array.isArray(removals.a)) {
    nextState.a = { ...nextState.a };
    for (const attributeKey of removals.a) {
      delete nextState.a[attributeKey];
    }
  }

  stateMap.set(entityId, nextState);
  return true;
}

function canonicalizeEntityState(entityState) {
  const nextState = cloneLoose(entityState ?? {});
  if (!nextState.a || typeof nextState.a !== "object" || Array.isArray(nextState.a)) {
    nextState.a = {};
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "lc") && !Object.prototype.hasOwnProperty.call(nextState, "lu")) {
    nextState.lu = nextState.lc;
  }
  return nextState;
}

function cloneEntityState(entityState) {
  return canonicalizeEntityState(entityState);
}

function cloneStateMap(stateMap) {
  const clone = new Map();
  for (const [entityId, entityState] of stateMap.entries()) {
    clone.set(entityId, cloneEntityState(entityState));
  }
  return clone;
}

function syncStateMapEntry(destination, source, entityId) {
  const nextState = source.get(entityId);
  if (!nextState) {
    destination.delete(entityId);
    return;
  }
  destination.set(entityId, cloneEntityState(nextState));
}

function createEmptyUpdates() {
  return { c: {} };
}

function countEntityUpdates(updates) {
  let count = 0;
  if (updates?.a && typeof updates.a === "object" && !Array.isArray(updates.a)) {
    count += Object.keys(updates.a).length;
  }
  if (Array.isArray(updates?.r)) {
    count += updates.r.length;
  }
  if (updates?.c && typeof updates.c === "object" && !Array.isArray(updates.c)) {
    count += Object.keys(updates.c).length;
  }
  return count;
}

function countFilteredEntityOccurrences(updates, resolvePolicy) {
  let filteredCount = 0;
  forEachEntityOccurrence(updates, (entityId) => {
    if (resolvePolicy(entityId).action !== "allow") {
      filteredCount += 1;
    }
  });
  return filteredCount;
}

function forEachEntityOccurrence(updates, callback) {
  if (updates?.a && typeof updates.a === "object" && !Array.isArray(updates.a)) {
    for (const entityId of Object.keys(updates.a)) {
      callback(entityId);
    }
  }

  if (Array.isArray(updates?.r)) {
    for (const entityId of updates.r) {
      if (typeof entityId === "string") {
        callback(entityId);
      }
    }
  }

  if (updates?.c && typeof updates.c === "object" && !Array.isArray(updates.c)) {
    for (const entityId of Object.keys(updates.c)) {
      callback(entityId);
    }
  }
}

function createPolicyResolver(resolvePolicy) {
  const cache = new Map();
  return (entityId) => {
    if (!cache.has(entityId)) {
      cache.set(entityId, resolvePolicy(entityId));
    }
    return cache.get(entityId);
  };
}

function normalizeSubscriptionId(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function cloneLoose(value) {
  return value === undefined ? undefined : structuredClone(value);
}

const defaultScheduler = {
  now: () => Date.now(),
  setTimeout: (fn, delay) => setTimeout(fn, delay),
  clearTimeout: (handle) => clearTimeout(handle),
};
