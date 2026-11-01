import { beforeEach, describe, expect, it } from 'vitest';

import { admit, release, resetAdmission } from '@/lib/admission';
import { LIMITS } from '@/lib/config';
import { resetQuota } from '@/lib/quota';
import { resetRateLimit } from '@/lib/ratelimit';

describe('admission control', () => {
  beforeEach(() => {
    resetAdmission();
    resetRateLimit();
    resetQuota();
  });

  it('admits a caller and reports the remaining allowance', async () => {
    const first = await admit('a', 1_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(LIMITS.requestsPerWindow - 1);
    expect(first.dailyRemaining).toBe(LIMITS.dailyScreens - 1);
    expect(first.quotaStore).toBe('memory');
  });

  it('refuses more parallel screens than one caller may run', async () => {
    const now = 2_000;
    expect((await admit('a', now)).allowed).toBe(true);
    expect((await admit('a', now)).allowed).toBe(true);
    const third = await admit('a', now);
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe('concurrency');
  });

  it('gives the slot back when the screen finishes', async () => {
    const now = 3_000;
    await admit('a', now);
    await admit('a', now);
    release('a');
    expect((await admit('a', now)).allowed).toBe(true);
  });

  it('keeps one caller from using up another caller concurrency slot', async () => {
    const now = 4_000;
    await admit('a', now);
    await admit('a', now);
    expect((await admit('b', now)).allowed).toBe(true);
  });

  it('does not spend the day budget on a request refused for concurrency', async () => {
    const now = 4_500;
    await admit('a', now);
    await admit('a', now);
    const refused = await admit('a', now);
    expect(refused.reason).toBe('concurrency');
    // Two admitted screens only: the third never reached the quota.
    const other = await admit('b', now);
    expect(other.dailyRemaining).toBe(LIMITS.dailyScreens - 3);
  });

  it('stops the whole deployment at the daily ceiling, whatever the IP', async () => {
    const now = Date.UTC(2026, 9, 31, 12, 0, 0);
    for (let index = 0; index < LIMITS.dailyScreens; index += 1) {
      const key = `caller-${index}`;
      expect((await admit(key, now)).allowed).toBe(true);
      release(key);
    }
    const over = await admit('one-more', now);
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe('daily_budget');
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the daily count on a new UTC day', async () => {
    const today = Date.UTC(2026, 9, 31, 23, 59, 0);
    for (let index = 0; index < LIMITS.dailyScreens; index += 1) {
      const key = `k-${index}`;
      await admit(key, today);
      release(key);
    }
    expect((await admit('late', today)).allowed).toBe(false);

    const tomorrow = Date.UTC(2026, 10, 1, 0, 1, 0);
    expect((await admit('early', tomorrow)).allowed).toBe(true);
  });
});
