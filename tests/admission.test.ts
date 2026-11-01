import { beforeEach, describe, expect, it } from 'vitest';

import { admit, release, resetAdmission } from '@/lib/admission';
import { LIMITS } from '@/lib/config';
import { resetRateLimit } from '@/lib/ratelimit';

describe('admission control', () => {
  beforeEach(() => {
    resetAdmission();
    resetRateLimit();
  });

  it('admits a caller and reports the remaining allowance', async () => {
    const first = await admit('a', 1_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(LIMITS.requestsPerWindow - 1);
    expect(first.limit).toBe(LIMITS.requestsPerWindow);
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

  it('refuses a caller that has used its window, whatever its concurrency', async () => {
    const now = 5_000;
    for (let index = 0; index < LIMITS.requestsPerWindow; index += 1) {
      expect((await admit('a', now)).allowed).toBe(true);
      release('a');
    }
    const refused = await admit('a', now);
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe('window');
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  // The daily ceiling is no longer decided here. `admit` answers about window and
  // concurrency; the route charges `consumeQuota()` after validation, so a request
  // that never reaches a detector cannot spend the deployment's allowance.
  it('answers only about window and concurrency', async () => {
    const result = await admit('a', 6_000);
    expect(Object.keys(result).sort()).toEqual(['allowed', 'limit', 'reason', 'remaining', 'retryAfterSeconds']);
  });
});
