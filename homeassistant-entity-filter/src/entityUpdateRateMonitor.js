export class EntityUpdateRateMonitor {
  constructor({
    thresholdPerMinute,
    windowMs = 180000,
    logger = console,
    clock = () => Date.now(),
  }) {
    this.thresholdPerMinute = thresholdPerMinute;
    this.windowMs = windowMs;
    this.windowMinutes = windowMs / 60000;
    this.windowLabel = formatWindowLabel(this.windowMinutes);
    this.logger = logger;
    this.clock = clock;
    this.warnedEntities = new Set();
    this.entityTimestamps = new Map();
  }

  record(entityId, timestamp = this.clock()) {
    if (this.thresholdPerMinute <= 0) {
      return;
    }
    if (this.warnedEntities.has(entityId)) {
      return;
    }

    const timestamps = this.entityTimestamps.get(entityId) ?? [];
    timestamps.push(timestamp);

    const cutoff = timestamp - this.windowMs;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length === 0) {
      this.entityTimestamps.delete(entityId);
      return;
    }

    this.entityTimestamps.set(entityId, timestamps);

    const count = timestamps.length;
    const averagePerMinute = count / this.windowMinutes;
    if (averagePerMinute <= this.thresholdPerMinute) {
      return;
    }

    this.logger.warn(
      `entity update rate warning: ${entityId} averaged ${averagePerMinute.toFixed(2)}/min over the last ${this.windowLabel} (${count} updates, threshold ${this.thresholdPerMinute.toFixed(2)}/min, process-wide upstream-allowed)`,
    );
    this.warnedEntities.add(entityId);
    this.entityTimestamps.delete(entityId);
  }
}

function formatWindowLabel(windowMinutes) {
  if (Number.isInteger(windowMinutes)) {
    return `${windowMinutes}m`;
  }
  return `${windowMinutes}m`;
}
