import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, checkLimit, resetLimits } from "@/lib/rate-limit";

beforeEach(() => {
  resetLimits();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkLimit", () => {
  it("allows requests up to the limit and blocks the one after", () => {
    const limit = LIMITS.diagnose;
    for (let i = 0; i < limit.max; i++) {
      expect(checkLimit("diagnose", "session-a").allowed, `call ${i}`).toBe(true);
    }
    expect(checkLimit("diagnose", "session-a").allowed).toBe(false);
  });

  it("keys counters separately per caller", () => {
    for (let i = 0; i < LIMITS.diagnose.max; i++) {
      checkLimit("diagnose", "session-a");
    }
    expect(checkLimit("diagnose", "session-a").allowed).toBe(false);
    expect(checkLimit("diagnose", "session-b").allowed).toBe(true);
  });

  it("keys counters separately per bucket", () => {
    for (let i = 0; i < LIMITS.diagnose.max; i++) {
      checkLimit("diagnose", "session-a");
    }
    expect(checkLimit("diagnose", "session-a").allowed).toBe(false);
    expect(checkLimit("chat", "session-a").allowed).toBe(true);
  });

  it("frees exactly one slot as each individual call ages out of the window", () => {
    const { max, windowMs } = LIMITS.diagnose;

    // Space the calls out so they expire one at a time rather than all together.
    for (let i = 0; i < max; i++) {
      checkLimit("diagnose", "session-a");
      vi.advanceTimersByTime(1000);
    }
    expect(checkLimit("diagnose", "session-a").allowed).toBe(false);

    // Just before the oldest call ages out, we are still blocked.
    vi.advanceTimersByTime(windowMs - max * 1000 - 10);
    expect(checkLimit("diagnose", "session-a").allowed).toBe(false);

    // Once it falls outside the window, exactly one slot frees up.
    vi.advanceTimersByTime(20);
    expect(checkLimit("diagnose", "session-a").allowed).toBe(true);
    expect(checkLimit("diagnose", "session-a").allowed).toBe(false);
  });

  it("reports how long the caller has to wait", () => {
    for (let i = 0; i < LIMITS.diagnose.max; i++) {
      checkLimit("diagnose", "session-a");
    }
    const result = checkLimit("diagnose", "session-a");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(LIMITS.diagnose.windowMs / 1000);
  });

  it("does not consume a slot when the call is rejected", () => {
    const { max, windowMs } = LIMITS.diagnose;
    for (let i = 0; i < max; i++) {
      checkLimit("diagnose", "session-a");
    }
    // Hammer the endpoint while blocked; this must not push the window forward.
    for (let i = 0; i < 20; i++) {
      checkLimit("diagnose", "session-a");
    }
    vi.advanceTimersByTime(windowMs + 1);
    expect(checkLimit("diagnose", "session-a").allowed).toBe(true);
  });

  it("treats the domain cap as a lifetime total, not a window", () => {
    expect(LIMITS.domains.windowMs).toBe(Number.POSITIVE_INFINITY);

    for (let i = 0; i < LIMITS.domains.max; i++) {
      expect(checkLimit("domains", "session-a").allowed).toBe(true);
    }
    expect(checkLimit("domains", "session-a").allowed).toBe(false);

    vi.advanceTimersByTime(1000 * 60 * 60 * 24 * 365);
    expect(checkLimit("domains", "session-a").allowed).toBe(false);
  });

  it("matches the limits the design spec calls for", () => {
    expect(LIMITS.diagnose).toMatchObject({ max: 10, windowMs: 60 * 60 * 1000 });
    expect(LIMITS.chat).toMatchObject({ max: 50, windowMs: 60 * 60 * 1000 });
    expect(LIMITS.ai_ip).toMatchObject({ max: 20, windowMs: 60 * 60 * 1000 });
    expect(LIMITS.domains.max).toBe(5);
  });

  it("exposes the remaining allowance so the UI can warn before the wall", () => {
    const first = checkLimit("chat", "session-a");
    expect(first.remaining).toBe(LIMITS.chat.max - 1);
  });
});
