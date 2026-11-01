/**
 * In-memory sliding-window rate limiter (per process). Good enough for a single API instance;
 * put a shared limiter (e.g. at the proxy) in front if you run several.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private lastSweep = 0;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Record a hit. Returns null when allowed, or the seconds to wait when limited. */
  hit(key: string, nowMs: number): number | null {
    this.sweep(nowMs);
    const cutoff = nowMs - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      const retryMs = list[0]! + this.windowMs - nowMs;
      return Math.max(1, Math.ceil(retryMs / 1000));
    }
    list.push(nowMs);
    this.hits.set(key, list);
    return null;
  }

  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweep < this.windowMs) return;
    this.lastSweep = nowMs;
    const cutoff = nowMs - this.windowMs;
    for (const [key, list] of this.hits) {
      if (list.length === 0 || list[list.length - 1]! <= cutoff) this.hits.delete(key);
    }
  }
}
