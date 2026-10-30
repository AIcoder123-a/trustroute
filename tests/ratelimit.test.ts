import { beforeEach, describe, expect, it } from 'vitest';

import { LIMITS } from '@/lib/config';
import { checkRateLimit, resetRateLimit } from '@/lib/ratelimit';

const WINDOW = LIMITS.windowMs;

describe('rate limiting', () => {
  beforeEach(() => resetRateLimit());

  it('allows requests up to the limit and then refuses', () => {
    const now = 1_000_000;
    for (let index = 0; index < LIMITS.requestsPerWindow; index += 1) {
      expect(checkRateLimit('a', now + index).allowed).toBe(true);
    }
    const denied = checkRateLimit('a', now + 100);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps separate buckets per caller', () => {
    const now = 2_000_000;
    for (let index = 0; index < LIMITS.requestsPerWindow; index += 1) checkRateLimit('a', now + index);
    expect(checkRateLimit('a', now + 500).allowed).toBe(false);
    expect(checkRateLimit('b', now + 500).allowed).toBe(true);
  });

  it('refills after the window passes', () => {
    const now = 3_000_000;
    for (let index = 0; index < LIMITS.requestsPerWindow; index += 1) checkRateLimit('a', now + index);
    expect(checkRateLimit('a', now + 10).allowed).toBe(false);
    expect(checkRateLimit('a', now + WINDOW + 1000).allowed).toBe(true);
  });
});
