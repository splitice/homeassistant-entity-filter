export class LegacyStateChangedManager {
  constructor({
    resolvePolicy,
    emitMessages,
    entityUpdateRateMonitor = null,
    scheduler = defaultScheduler,
    logger = console,
  }) {
    this.resolvePolicy = resolvePolicy;
    this.emitMessages = emitMessages;
    this.entityUpdateRateMonitor = entityUpdateRateMonitor;
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
      this.subscriptions.set(id, {
        id,
        entities: new Map(),
        timer: null,
      });
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

    if (message.type !== "event" || message.event?.event_type !== "state_changed") {
      return [message];
    }

    const entityId = message.event?.data?.entity_id;
    if (typeof entityId !== "string") {
      return [message];
    }

    const policy = this.resolvePolicy(entityId);
    if (policy.action !== "allow") {
      return [];
    }

    const now = this.scheduler.now();
    this.entityUpdateRateMonitor?.record(entityId, now);

    const rateLimitMs = policy.rateLimitMs ?? null;
    if (!rateLimitMs) {
      return [message];
    }

    const slot = ensureEntitySlot(subscription, entityId, rateLimitMs);
    if (!slot.pendingMessage && now >= slot.nextAllowedAt) {
      slot.nextAllowedAt = now + rateLimitMs;
      return [message];
    }

    slot.pendingMessage = structuredClone(message);
    this._scheduleFlush(subscription);
    return [];
  }

  _scheduleFlush(subscription) {
    if (subscription.timer) {
      this.scheduler.clearTimeout(subscription.timer);
      subscription.timer = null;
    }

    let nextDueAt = Infinity;
    for (const slot of subscription.entities.values()) {
      if (slot.pendingMessage) {
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

    const now = this.scheduler.now();
    const dueMessages = [];

    for (const slot of subscription.entities.values()) {
      if (!slot.pendingMessage || slot.nextAllowedAt > now) {
        continue;
      }

      dueMessages.push(slot.pendingMessage);
      slot.pendingMessage = null;
      slot.nextAllowedAt = now + slot.rateLimitMs;
    }

    if (dueMessages.length > 0) {
      Promise.resolve(this.emitMessages(dueMessages)).catch((error) => {
        this.logger.error(`legacy flush failed for subscription ${subscription.id}: ${error.message}`);
      });
    }

    this._scheduleFlush(subscription);
  }
}

function ensureEntitySlot(subscription, entityId, rateLimitMs) {
  let slot = subscription.entities.get(entityId);
  if (!slot) {
    slot = {
      nextAllowedAt: 0,
      pendingMessage: null,
      rateLimitMs,
    };
    subscription.entities.set(entityId, slot);
  }
  slot.rateLimitMs = rateLimitMs;
  return slot;
}

function normalizeSubscriptionId(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

const defaultScheduler = {
  now: () => Date.now(),
  setTimeout: (fn, delay) => setTimeout(fn, delay),
  clearTimeout: (handle) => clearTimeout(handle),
};
