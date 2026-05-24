export class EventSummaryReporter {
  constructor({
    logger = console,
    intervalMs = 300000,
    scheduler = defaultScheduler,
  } = {}) {
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.scheduler = scheduler;
    this.forwarded = 0;
    this.filtered = 0;
    this.rateLimitedDropped = 0;
    this.intervalHandle = this.scheduler.setInterval(() => {
      this._flushWindow();
    }, this.intervalMs);
  }

  recordForwarded(count = 1) {
    this.forwarded += normalizeCount(count);
  }

  recordFiltered(count = 1) {
    this.filtered += normalizeCount(count);
  }

  recordRateLimitedDropped(count = 1) {
    this.rateLimitedDropped += normalizeCount(count);
  }

  close() {
    if (!this.intervalHandle) {
      return;
    }
    this.scheduler.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  _flushWindow() {
    this.logger.info(
      `event summary (last 5m): forwarded=${this.forwarded} filtered=${this.filtered} rate_limited_dropped=${this.rateLimitedDropped}`,
    );
    this.forwarded = 0;
    this.filtered = 0;
    this.rateLimitedDropped = 0;
  }
}

function normalizeCount(count) {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.trunc(count);
}

const defaultScheduler = {
  setInterval: (fn, delay) => setInterval(fn, delay),
  clearInterval: (handle) => clearInterval(handle),
};
