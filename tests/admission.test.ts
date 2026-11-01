import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { admit, release, resetAdmission, windowStore } from '@/lib/admission';
import { LIMITS } from '@/lib/config';
import { resetRateLimit } from '@/lib/ratelimit';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('admission control', () => {
  beforeEach(() => {
    resetAdmission();
    resetRateLimit();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
    expect(Object.keys(result).sort()).toEqual(['allowed', 'limit', 'reason', 'remaining', 'retryAfterSeconds', 'store']);
  });

  /**
   * On a serverless host the process-local map counts for one invocation. The
   * shared window is what makes this ceiling mean anything there, so its wiring
   * is checked rather than assumed.
   */
  it('counts the window in Redis when one is configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse({ result: 2 }));
    vi.stubGlobal('fetch', fetchImpl);

    expect(windowStore()).toBe('redis');
    const result = await admit('a', 7_000);
    expect(result.allowed).toBe(true);
    expect(result.store).toBe('redis');
    expect(result.remaining).toBe(LIMITS.requestsPerWindow - 2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses on a window exhausted in Redis, not in this instance', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ result: LIMITS.requestsPerWindow + 1 })));

    const result = await admit('a', 7_500);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('window');
    expect(result.store).toBe('redis');
  });

  /**
   * Not fail-closed, unlike the daily quota: an unreadable fairness counter must
   * not take the demo down, because it cannot cost anything. The quota is charged
   * later in the route and refuses there.
   */
  it('falls back to the in-process window when Redis cannot answer', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      }),
    );

    const result = await admit('a', 8_000);
    expect(result.allowed).toBe(true);
    expect(result.store).toBe('memory');
  });
});
