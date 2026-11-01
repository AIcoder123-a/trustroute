/**
 * Admission control for the public screening route.
 *
 * Four independent ceilings, because they fail in different ways:
 *
 *   1. **Proof of a human** (`lib/turnstile.ts`) — a script that never renders the
 *      page has no token, so it never reaches the counters below.
 *   2. **Per caller, per window** (`lib/ratelimit.ts`) — one visitor pressing the
 *      button in a loop.
 *   3. **Per caller, concurrent** — one visitor opening ten tabs. Ten parallel
 *      screens cost the same credits as ten sequential ones, but they also run
 *      ten model calls at once, which is how a free demo trips a concurrency
 *      limit at the provider.
 *   4. **Whole deployment, per UTC day** (`lib/quota.ts`) — the credit balance.
 *      Per-caller limits do nothing against a hundred callers, and this is the
 *      only ceiling that bounds what the account can be charged in a day.
 *
 * Only (2) and (3) stay in process memory: a shared counter per window is not
 * worth a network round trip, and a concurrency slot is meaningful per instance
 * anyway. (4) is the one that guards money, so it is the one that moves to Redis
 * when Redis is configured — and it fails closed when Redis cannot answer.
 *
 * `docs/SECURITY_NOTES.md` §12 states exactly what each store does and does not
 * guarantee.
 */

import { LIMITS } from './config';
import { consumeQuota, type QuotaStore } from './quota';
import { checkRateLimit } from './ratelimit';

export type AdmissionReason = 'window' | 'concurrency' | 'daily_budget' | 'quota_unavailable';

export interface AdmissionResult {
  allowed: boolean;
  reason: AdmissionReason | null;
  retryAfterSeconds: number;
  /** Requests left in this caller's window. */
  remaining: number;
  limit: number;
  /** Screens left in the deployment's day. Never negative. */
  dailyRemaining: number;
  /** Where the daily counter lives — surfaced so an operator cannot misread it. */
  quotaStore: QuotaStore;
}

const inFlight = new Map<string, number>();

/**
 * Reserves one screening. A successful reservation must be paired with
 * `release()` in a `finally` block, or the caller's concurrency slot leaks.
 *
 * The daily quota is consumed **last**, so a request refused for concurrency or
 * for its window does not spend the deployment's allowance for everybody else.
 */
export async function admit(
  key: string,
  now = Date.now(),
  options: { fetchImpl?: typeof fetch } = {},
): Promise<AdmissionResult> {
  const running = inFlight.get(key) ?? 0;
  const base = {
    remaining: 0,
    limit: LIMITS.requestsPerWindow,
    dailyRemaining: 0,
  };

  if (running >= LIMITS.concurrentPerCaller) {
    return {
      ...base,
      allowed: false,
      reason: 'concurrency',
      retryAfterSeconds: 3,
      quotaStore: 'memory',
    };
  }

  const window = checkRateLimit(key, now);
  if (!window.allowed) {
    return {
      ...base,
      allowed: false,
      reason: 'window',
      retryAfterSeconds: window.retryAfterSeconds,
      quotaStore: 'memory',
    };
  }

  const quota = await consumeQuota(now, { fetchImpl: options.fetchImpl });
  if (!quota.allowed) {
    return {
      allowed: false,
      reason: quota.reason === 'store_unavailable' ? 'quota_unavailable' : 'daily_budget',
      retryAfterSeconds: quota.retryAfterSeconds,
      remaining: window.remaining,
      limit: window.limit,
      dailyRemaining: quota.remaining,
      quotaStore: quota.store,
    };
  }

  inFlight.set(key, running + 1);

  return {
    allowed: true,
    reason: null,
    retryAfterSeconds: 0,
    remaining: window.remaining,
    limit: window.limit,
    dailyRemaining: quota.remaining,
    quotaStore: quota.store,
  };
}

export function release(key: string): void {
  const running = inFlight.get(key) ?? 0;
  if (running <= 1) inFlight.delete(key);
  else inFlight.set(key, running - 1);
}

/** Test hook. Never called by application code. */
export function resetAdmission(): void {
  inFlight.clear();
}
