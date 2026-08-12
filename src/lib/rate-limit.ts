/**
 * In-memory sliding-window rate limiting.
 *
 * The AI endpoints spend our Anthropic credits on behalf of anonymous visitors,
 * so they need a ceiling. This is deliberately in-process: it is correct for a
 * single instance and good enough for a demo, and it costs nothing to run. In
 * production this would move to Redis/Upstash so the counters survive a restart
 * and are shared across serverless instances — see the README.
 */

export type LimitBucket = "diagnose" | "chat" | "ai_ip" | "domains";

export type Limit = { max: number; windowMs: number };

const HOUR = 60 * 60 * 1000;

export const LIMITS: Record<LimitBucket, Limit> = {
  diagnose: { max: 10, windowMs: HOUR },
  chat: { max: 50, windowMs: HOUR },
  ai_ip: { max: 20, windowMs: HOUR },
  // A lifetime cap rather than a rolling one: five domains is enough to try the
  // product, and an infinite window means the slots never come back.
  domains: { max: 5, windowMs: Number.POSITIVE_INFINITY },
};

export type LimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const hits = new Map<string, number[]>();

/** Test-only: drop all counters so cases don't leak into each other. */
export function resetLimits(): void {
  hits.clear();
}

/**
 * Record an attempt against `bucket` for `key` and say whether it is allowed.
 *
 * A rejected call does not consume a slot — otherwise a client hammering a
 * blocked endpoint would keep pushing its own window forward and lock itself
 * out indefinitely.
 */
export function checkLimit(bucket: LimitBucket, key: string): LimitResult {
  const { max, windowMs } = LIMITS[bucket];
  const now = Date.now();
  const id = `${bucket}:${key}`;

  const previous = hits.get(id) ?? [];
  const live = Number.isFinite(windowMs)
    ? previous.filter((at) => now - at < windowMs)
    : previous;

  if (live.length >= max) {
    hits.set(id, live);
    const oldest = live[0];
    const retryAfterSeconds = Number.isFinite(windowMs)
      ? Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000))
      : Number.POSITIVE_INFINITY;
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  live.push(now);
  hits.set(id, live);

  return { allowed: true, remaining: max - live.length, retryAfterSeconds: 0 };
}
