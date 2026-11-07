/**
 * Per-caller request window — the fairness ceiling, not the money ceiling.
 *
 * This is the counter that stops one visitor pressing the button two hundred
 * times, and it exists in two forms for one reason: on a serverless host it
 * cannot live in process memory.
 *
 *   - **memory** (default) — exact on a single long-lived process, which is what
 *     `next start` and Render Free are. On a serverless host each invocation may
 *     run in a fresh, isolated instance that is discarded afterwards, so the map
 *     below each caller's key is shared with nobody and remembered by nobody.
 *     The counter does not become "approximate"; it stops counting at all.
 *   - **redis** — one atomic `INCR` per caller per window, in a key that expires
 *     on its own. Every instance sees the same number.
 *
 * What that costs on a serverless host if Redis is absent: the daily quota in
 * `lib/quota.ts` still caps what the account can be charged, so money is safe.
 * What is not safe is availability — one caller can spend the whole day's
 * allowance in seconds and leave nothing for a judge. That is the reason the
 * shared window exists, and the reason `scripts/deploy-preflight.mjs` refuses a
 * live deployment whose counters are process-local.
 *
 * The window is a fixed window, not a sliding log: a burst that straddles a
 * boundary can spend up to twice the limit. It is a fairness partition — the
 * ceilings that bound risk are the daily quota and the Turnstile gate.
 */

import { createHash } from 'node:crypto';

import { LIMITS } from './config';
import { RedisCallError, logRedisFailure, redisCommand } from './redis-rest';

export type WindowStore = 'redis' | 'memory';

export interface WindowResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
  store: WindowStore;
}

/**
 * `KEYS[1]` the window key, `ARGV[1]` its lifetime in milliseconds. Returns the
 * count after this request, so the ceiling is applied by the caller rather than
 * baked into the script — the same script serves any limit.
 */
const WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`.trim();

/**
 * The caller key is hashed before it reaches a key name: this store is operated
 * on somebody else's Redis, and an address is a person. The bucket index keeps
 * windows disjoint without needing a sliding set.
 */
export function windowKey(callerKey: string, now: number): string {
  const bucket = Math.floor(now / LIMITS.windowMs);
  const digest = createHash('sha256').update(callerKey).digest('hex').slice(0, 24);
  return `trustroute:win:${digest}:${bucket}`;
}

export function secondsLeftInWindow(now: number): number {
  return Math.max(1, Math.ceil((LIMITS.windowMs - (now % LIMITS.windowMs)) / 1000));
}

/**
 * Charges one request against the caller's window in Redis.
 *
 * Throws when Redis cannot answer. The caller decides what that means — it is
 * not fail-closed here, unlike the daily quota, because the quota that guards
 * money is checked later and fails closed on its own. Turning a window outage
 * into a 503 would make the demo unavailable for a reason that cannot cost
 * anything.
 */
export async function consumeWindow(
  callerKey: string,
  now = Date.now(),
  options: { fetchImpl?: typeof fetch; limit?: number } = {},
): Promise<WindowResult> {
  const limit = options.limit ?? LIMITS.requestsPerWindow;

  const count = Number(
    await redisCommand({
      command: ['EVAL', WINDOW_SCRIPT, 1, windowKey(callerKey, now), LIMITS.windowMs],
      op: 'window',
      fetchImpl: options.fetchImpl,
    }),
  );
  if (!Number.isFinite(count)) {
    logRedisFailure('redis_bad_shape', 'window');
    throw new RedisCallError('redis_bad_shape');
  }

  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    limit,
    retryAfterSeconds: allowed ? 0 : secondsLeftInWindow(now),
    store: 'redis',
  };
}
