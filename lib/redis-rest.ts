/**
 * Minimal REST client for a Redis-compatible endpoint (Upstash, or any host that
 * speaks the same single-command JSON protocol).
 *
 * Why REST and not a Redis client: the free tiers this demo can use expose an
 * HTTPS endpoint with a bearer token, and a `fetch` call has no connection pool
 * to leak in a short-lived serverless invocation. The whole surface this project
 * needs is six commands, so the client is thirty lines rather than a dependency.
 *
 * Nothing here is active unless `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` are both set. See docs/DEPLOYMENT.md §5.2.
 */

export interface RedisCall {
  /** Redis command as an array, e.g. `['INCR', 'key']`. */
  command: Array<string | number>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class RedisNotConfiguredError extends Error {
  constructor() {
    super('No Redis endpoint is configured.');
    this.name = 'RedisNotConfiguredError';
  }
}

function credentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

export function redisConfigured(): boolean {
  return credentials() !== null;
}

/**
 * Runs one command and returns its `result`. Throws on anything that is not a
 * clean `{ result: … }` — the callers are all fail-closed, so an ambiguous
 * answer must be an error rather than a guess.
 */
export async function redisCommand({ command, fetchImpl = fetch, timeoutMs = 3000 }: RedisCall): Promise<unknown> {
  const config = credentials();
  if (!config) throw new RedisNotConfiguredError();

  const response = await fetchImpl(config.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`Redis answered ${response.status}`);

  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (typeof payload.error === 'string') throw new Error(`Redis error: ${payload.error.slice(0, 80)}`);
  if (!('result' in payload)) throw new Error('Redis answered without a result field');
  return payload.result;
}
