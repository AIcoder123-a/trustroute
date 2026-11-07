import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedisCallError, redisCommand, redisEndpointValid } from '@/lib/redis-rest';
import { consumeQuota, resetQuota } from '@/lib/quota';

/**
 * Every Redis failure has to name itself in one log line, because the first live
 * deployment could only report "the screening budget could not be checked" for a
 * wrong URL, a wrong token, a timeout and a broken reply alike.
 *
 * These tests assert the code, the status and the stage — and that the line
 * carries nothing else.
 */

const DAY = Date.UTC(2026, 10, 7, 10, 0, 0);

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function networkError(): Error {
  return new TypeError('fetch failed');
}

function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

function linesOf(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls.map((call) => String(call[0]).replace(/ ms=\d+$/, ' ms=N'));
}

describe('redis failure classification', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
    resetQuota();
  });

  it('refuses an endpoint that is not an http(s) URL without calling fetch', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'redis.example');
    const fetchImpl = vi.fn(async () => json({ result: 1 }));

    await expect(redisCommand({ command: ['PING'], op: 'quota', fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject(
      { code: 'redis_bad_url' },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(redisEndpointValid()).toBe(false);
    expect(linesOf(warn)).toEqual(['[trustroute] redis failure code=redis_bad_url op=quota status=none ms=N']);
  });

  it('unwraps a quoted value and leaves a legitimate URL untouched', async () => {
    const fetchImpl = vi.fn(async () => json({ result: 'OK' }));

    vi.stubEnv('UPSTASH_REDIS_REST_URL', '"https://redis.example"');
    await redisCommand({ command: ['PING'], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(redisEndpointValid()).toBe(true);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://redis.example');

    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example/');
    await redisCommand({ command: ['PING'], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe('https://redis.example');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'redis_http_401'],
    [403, 'redis_http_403'],
    [400, 'redis_http_4xx'],
    [429, 'redis_http_4xx'],
    [500, 'redis_http_5xx'],
    [503, 'redis_http_5xx'],
  ])('names the HTTP status %i as %s', async (status, code) => {
    const fetchImpl = vi.fn(async () => json({ error: 'rejected' }, status));

    await expect(
      redisCommand({ command: ['EVAL', 'return 1', 0], op: 'quota', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code, status });

    expect(linesOf(warn)).toEqual([`[trustroute] redis failure code=${code} op=quota status=${status} ms=N`]);
  });

  it('separates a command error inside a 200 from an unreadable body', async () => {
    const withError = vi.fn(async () => json({ error: 'ERR user_script:1: nope' }));
    await expect(
      redisCommand({ command: ['EVAL', 'return 1', 0], op: 'quota', fetchImpl: withError as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'redis_body_error', status: 200 });

    const notJson = vi.fn(
      async () => new Response('<!doctype html><title>Blocked</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    await expect(
      redisCommand({ command: ['EVAL', 'return 1', 0], op: 'quota', fetchImpl: notJson as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'redis_unreadable_body', status: 200 });

    expect(linesOf(warn)).toEqual([
      '[trustroute] redis failure code=redis_body_error op=quota status=200 ms=N',
      '[trustroute] redis failure code=redis_unreadable_body op=quota status=200 ms=N',
    ]);
  });

  it('distinguishes a timeout from a transport failure', async () => {
    const timeout = vi.fn(async () => {
      throw timeoutError();
    });
    await expect(
      redisCommand({ command: ['PING'], op: 'window', fetchImpl: timeout as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'redis_timeout' });

    const offline = vi.fn(async () => {
      throw networkError();
    });
    await expect(
      redisCommand({ command: ['PING'], op: 'window', fetchImpl: offline as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'redis_network' });

    expect(linesOf(warn)).toEqual([
      '[trustroute] redis failure code=redis_timeout op=window status=none ms=N',
      '[trustroute] redis failure code=redis_network op=window status=none ms=N',
    ]);
  });

  it('keeps the URL, the token and the command out of the log line', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://us1-secret-host-4242.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok_live_do_not_print');
    const fetchImpl = vi.fn(async () => json({ error: 'WRONGPASS invalid password' }, 401));

    await expect(
      redisCommand({
        command: ['EVAL', 'redis.call("INCR", KEYS[1])', 1, 'trustroute:quota:2026-11-07'],
        op: 'quota',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(RedisCallError);

    const line = linesOf(warn)[0] ?? '';
    expect(line).toContain('code=redis_http_401');
    for (const forbidden of ['upstash.io', 'tok_live', 'INCR', 'trustroute:', 'WRONGPASS', 'Bearer']) {
      expect(line).not.toContain(forbidden);
    }
  });

  it('reports a malformed quota reply as one shape failure, not two', async () => {
    const fetchImpl = vi.fn(async () => json({ result: 'PONG' }));
    const result = await consumeQuota(DAY, { fetchImpl: fetchImpl as unknown as typeof fetch, limit: 20 });

    expect(result.reason).toBe('store_unavailable');
    expect(linesOf(warn)).toEqual(['[trustroute] redis failure code=redis_bad_shape op=quota status=none ms=unknown']);
  });
});
