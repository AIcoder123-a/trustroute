import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeQuota, quotaStore, resetQuota } from '@/lib/quota';

const DAY = Date.UTC(2026, 10, 1, 10, 0, 0);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('daily quota', () => {
  beforeEach(() => {
    resetQuota();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetQuota();
  });

  it('counts against process memory when no Redis is configured', async () => {
    expect(quotaStore()).toBe('memory');
    const first = await consumeQuota(DAY, { limit: 2 });
    expect(first).toMatchObject({ allowed: true, store: 'memory', remaining: 1, reason: 'ok' });

    await consumeQuota(DAY, { limit: 2 });
    const third = await consumeQuota(DAY, { limit: 2 });
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe('exhausted');
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the memory counter on a new UTC day', async () => {
    await consumeQuota(DAY, { limit: 1 });
    expect((await consumeQuota(DAY, { limit: 1 })).allowed).toBe(false);
    const tomorrow = Date.UTC(2026, 10, 2, 0, 0, 1);
    expect((await consumeQuota(tomorrow, { limit: 1 })).allowed).toBe(true);
  });

  it('uses one atomic EVAL against Redis, keyed by the UTC day', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
    expect(quotaStore()).toBe('redis');

    const fetchImpl = vi.fn(async () => jsonResponse({ result: [3, 1] }));
    const result = await consumeQuota(DAY, { fetchImpl: fetchImpl as unknown as typeof fetch, limit: 10 });

    expect(result).toMatchObject({ allowed: true, store: 'redis', remaining: 7, reason: 'ok' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://redis.example');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-token');
    const command = JSON.parse(String(init.body)) as Array<string | number>;
    expect(command[0]).toBe('EVAL');
    expect(command[2]).toBe(1);
    expect(String(command[3])).toBe('trustroute:quota:2026-11-01');
    // TTL is the number of seconds left in the UTC day, so the key cleans itself up.
    expect(Number(command[4])).toBe(50_400);
    expect(Number(command[5])).toBe(10);
  });

  it('refuses once Redis reports the ceiling is reached', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');

    const fetchImpl = vi.fn(async () => jsonResponse({ result: [11, 0] }));
    const result = await consumeQuota(DAY, { fetchImpl: fetchImpl as unknown as typeof fetch, limit: 10 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('exhausted');
    expect(result.remaining).toBe(0);
  });

  it('fails closed when Redis cannot be reached', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');

    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const result = await consumeQuota(DAY, { fetchImpl: fetchImpl as unknown as typeof fetch, limit: 10 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('store_unavailable');
    expect(result.store).toBe('redis');
  });

  it('fails closed when Redis answers with an error or a malformed reply', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');

    const httpError = vi.fn(async () => jsonResponse({ error: 'WRONGPASS' }, 401));
    expect((await consumeQuota(DAY, { fetchImpl: httpError as unknown as typeof fetch, limit: 10 })).reason).toBe(
      'store_unavailable',
    );

    const oddShape = vi.fn(async () => jsonResponse({ result: 'PONG' }));
    expect((await consumeQuota(DAY, { fetchImpl: oddShape as unknown as typeof fetch, limit: 10 })).reason).toBe(
      'store_unavailable',
    );
  });
});
