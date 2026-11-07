/**
 * Whole-deployment daily quota for screening calls.
 *
 * This is the ceiling that protects the Clocked credit balance: per-caller
 * counters stop one visitor, not a hundred. Two stores, chosen by configuration:
 *
 *   - **redis** — an atomic `INCR` on one key per UTC day, executed as a Lua
 *     script so the increment and its expiry are one operation. Shared by every
 *     instance, survives restarts, and expires on its own at midnight UTC.
 *   - **memory** — the process-local counter this project shipped first. Exact on
 *     one instance, `N × limit` on many, and reset by a cold start or redeploy.
 *
 * The store is the only place that differs; callers see the same `QuotaResult`.
 * Redis failures are **fail-closed**: if the counter cannot be read or written,
 * the screening is refused rather than allowed, because the alternative is an
 * unbounded spend on an account somebody else owns.
 *
 * See docs/DEPLOYMENT.md §5.2 and docs/SECURITY_NOTES.md §12.
 */

import { LIMITS } from './config';
import { RedisCallError, logRedisFailure, redisCommand, redisConfigured } from './redis-rest';

export type QuotaStore = 'redis' | 'memory';
export type QuotaReason = 'ok' | 'exhausted' | 'store_unavailable';

export interface QuotaResult {
  allowed: boolean;
  reason: QuotaReason;
  remaining: number;
  limit: number;
  store: QuotaStore;
  /** Seconds until the quota resets — to UTC midnight. */
  retryAfterSeconds: number;
}

/**
 * Increments the day's counter and reports whether the caller may proceed, in a
 * single round trip. `KEYS[1]` is the day key, `ARGV[1]` its TTL in seconds,
 * `ARGV[2]` the ceiling. Returns `{count, allowed}`.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if count > tonumber(ARGV[2]) then return {count, 0} end
return {count, 1}
`.trim();

let day = '';
let spentToday = 0;

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function secondsUntilUtcMidnight(now: number): number {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

function quotaKey(now: number): string {
  return `trustroute:quota:${utcDay(now)}`;
}

function memoryConsume(now: number, limit: number): QuotaResult {
  const today = utcDay(now);
  if (today !== day) {
    day = today;
    spentToday = 0;
  }
  if (spentToday >= limit) {
    return {
      allowed: false,
      reason: 'exhausted',
      remaining: 0,
      limit,
      store: 'memory',
      retryAfterSeconds: secondsUntilUtcMidnight(now),
    };
  }
  spentToday += 1;
  return {
    allowed: true,
    reason: 'ok',
    remaining: Math.max(0, limit - spentToday),
    limit,
    store: 'memory',
    retryAfterSeconds: 0,
  };
}

/**
 * Reserves one screening against the day's budget.
 *
 * A reservation that is refused must not be refunded — nothing was spent. A
 * reservation that is granted but whose screening then fails still counts, which
 * is deliberate: a failing pipeline can still have been billed upstream.
 */
export async function consumeQuota(
  now = Date.now(),
  options: { fetchImpl?: typeof fetch; limit?: number } = {},
): Promise<QuotaResult> {
  const limit = options.limit ?? LIMITS.dailyScreens;

  if (!redisConfigured()) return memoryConsume(now, limit);

  const ttl = secondsUntilUtcMidnight(now);
  try {
    const result = await redisCommand({
      command: ['EVAL', CONSUME_SCRIPT, 1, quotaKey(now), ttl, limit],
      op: 'quota',
      fetchImpl: options.fetchImpl,
    });
    if (!Array.isArray(result) || result.length !== 2) {
      logRedisFailure('redis_bad_shape', 'quota');
      throw new RedisCallError('redis_bad_shape');
    }
    const count = Number(result[0]);
    const allowed = Number(result[1]) === 1;
    if (!Number.isFinite(count)) {
      logRedisFailure('redis_bad_shape', 'quota');
      throw new RedisCallError('redis_bad_shape');
    }
    return {
      allowed,
      reason: allowed ? 'ok' : 'exhausted',
      remaining: Math.max(0, limit - count),
      limit,
      store: 'redis',
      retryAfterSeconds: allowed ? 0 : ttl,
    };
  } catch (error) {
    // Fail closed. An unreachable counter means the ceiling is unknown, and an
    // unknown ceiling on somebody else's credit balance is not a risk worth taking.
    //
    // The reason itself is already on the log line `redis-rest` wrote, or was
    // written just above; only an error that bypassed both is reported here, so
    // one failed call never produces two lines.
    if (!(error instanceof RedisCallError)) logRedisFailure('redis_network', 'quota');
    return {
      allowed: false,
      reason: 'store_unavailable',
      remaining: 0,
      limit,
      store: 'redis',
      retryAfterSeconds: 30,
    };
  }
}

/** The store in use, for `/api/status` and for the operator's own reasoning. */
export function quotaStore(): QuotaStore {
  return redisConfigured() ? 'redis' : 'memory';
}

/** Test hook. Never called by application code. */
export function resetQuota(): void {
  day = '';
  spentToday = 0;
}
