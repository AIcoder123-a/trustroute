import { afterEach, describe, expect, it, vi } from 'vitest';

import { LIMITS } from '@/lib/config';
import { consumeWindow, secondsLeftInWindow, windowKey } from '@/lib/window';

const WINDOW = LIMITS.windowMs;
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function fetchReturning(value: unknown) {
  return vi.fn(async () => jsonResponse({ result: value }));
}

describe('shared window', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not put the caller address in the key name', () => {
    const key = windowKey('203.0.113.9', NOW);
    expect(key).not.toContain('203.0.113.9');
    expect(key.startsWith('trustroute:win:')).toBe(true);
  });

  it('uses one key per caller per window, and a new one in the next window', () => {
    const same = windowKey('203.0.113.9', NOW);
    expect(windowKey('203.0.113.9', NOW + 1000)).toBe(same);
    expect(windowKey('203.0.113.10', NOW)).not.toBe(same);
    expect(windowKey('203.0.113.9', NOW + WINDOW)).not.toBe(same);
  });

  it('charges one atomic INCR with an expiry, so the key cleans itself up', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');

    const fetchImpl = fetchReturning(3);
    const result = await consumeWindow('203.0.113.9', NOW, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      limit: 20,
    });

    expect(result).toMatchObject({ allowed: true, store: 'redis', remaining: 17, limit: 20 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const command = JSON.parse(String(init.body)) as Array<string | number>;
    expect(command[0]).toBe('EVAL');
    expect(command[2]).toBe(1);
    expect(String(command[3])).toBe(windowKey('203.0.113.9', NOW));
    expect(Number(command[4])).toBe(WINDOW);
  });

  it('refuses past the limit and says how long is left in the window', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');

    const fetchImpl = fetchReturning(21);
    const result = await consumeWindow('203.0.113.9', NOW, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      limit: 20,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBe(secondsLeftInWindow(NOW));
  });

  it('throws when Redis cannot answer, so the caller chooses what that means', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');

    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    await expect(
      consumeWindow('203.0.113.9', NOW, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow();

    const oddShape = vi.fn(async () => jsonResponse({ result: 'PONG' }));
    await expect(
      consumeWindow('203.0.113.9', NOW, { fetchImpl: oddShape as unknown as typeof fetch }),
    ).rejects.toThrow();
  });

  it('reports the tail of the window, not a full one, once it is under way', () => {
    expect(secondsLeftInWindow(NOW)).toBe(WINDOW / 1000);
    expect(secondsLeftInWindow(NOW + WINDOW - 2000)).toBe(2);
  });
});
