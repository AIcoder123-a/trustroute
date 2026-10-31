import { beforeEach, describe, expect, it } from 'vitest';

import { admit, release, resetAdmission } from '@/lib/admission';
import { LIMITS } from '@/lib/config';
import { resetRateLimit } from '@/lib/ratelimit';

describe('admission control', () => {
  beforeEach(() => {
    resetAdmission();
    resetRateLimit();
  });

  it('admits a caller and reports the remaining allowance', () => {
    const first = admit('a', 1_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(LIMITS.requestsPerWindow - 1);
    expect(first.dailyRemaining).toBe(LIMITS.dailyScreens - 1);
  });

  it('refuses more parallel screens than one caller may run', () => {
    const now = 2_000;
    expect(admit('a', now).allowed).toBe(true);
    expect(admit('a', now).allowed).toBe(true);
    const third = admit('a', now);
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe('concurrency');
  });

  it('gives the slot back when the screen finishes', () => {
    const now = 3_000;
    admit('a', now);
    admit('a', now);
    release('a');
    expect(admit('a', now).allowed).toBe(true);
  });

  it('keeps one caller from using up another caller concurrency slot', () => {
    const now = 4_000;
    admit('a', now);
    admit('a', now);
    expect(admit('b', now).allowed).toBe(true);
  });

  it('stops the whole deployment at the daily ceiling, whatever the IP', () => {
    const now = Date.UTC(2026, 9, 31, 12, 0, 0);
    for (let index = 0; index < LIMITS.dailyScreens; index += 1) {
      const key = `caller-${index}`;
      expect(admit(key, now).allowed).toBe(true);
      release(key);
    }
    const over = admit('one-more', now);
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe('daily_budget');
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the daily count on a new UTC day', () => {
    const today = Date.UTC(2026, 9, 31, 23, 59, 0);
    for (let index = 0; index < LIMITS.dailyScreens; index += 1) {
      const key = `k-${index}`;
      admit(key, today);
      release(key);
    }
    expect(admit('late', today).allowed).toBe(false);

    const tomorrow = Date.UTC(2026, 10, 1, 0, 1, 0);
    expect(admit('early', tomorrow).allowed).toBe(true);
  });
});
