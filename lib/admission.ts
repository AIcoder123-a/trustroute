/**
 * Admission control for the public screening route.
 *
 * Four independent ceilings, because they fail in different ways:
 *
 *   1. **Proof of a human** (`lib/turnstile.ts`) — a script that never renders the
 *      page has no token, so it never reaches the counters below.
 *   2. **Per caller, per window** (`lib/window.ts`) — one visitor pressing the
 *      button in a loop.
 *   3. **Per caller, concurrent** — one visitor opening ten tabs. Ten parallel
 *      screens cost the same credits as ten sequential ones, but they also run
 *      ten model calls at once, which is how a free demo trips a concurrency
 *      limit at the provider.
 *   4. **Whole deployment, per UTC day** (`lib/quota.ts`) — the credit balance.
 *      Per-caller limits do nothing against a hundred callers, and this is the
 *      only ceiling that bounds what the account can be charged in a day.
 *
 * (1)–(3) run here, in `admit()`. (4) does **not**: the route calls
 * `consumeQuota()` only after the body has parsed and validated, so a request
 * that never reaches a detector — a typo, a paste that is too long, a malformed
 * body — does not spend a day of allowance that a real screening needs. The
 * counter that guards money should be charged for screenings, not for attempts.
 *
 * Where each counter lives is a function of the host, not a preference:
 *
 *   - (2) goes to Redis when `UPSTASH_REDIS_REST_*` is set, because on a
 *     serverless host a process-local map counts for exactly one invocation and
 *     then disappears. See `lib/window.ts` for what that costs when it is
 *     missing, and why it is not fail-closed.
 *   - (3) stays in process memory on purpose. A concurrency slot is meaningful
 *     per instance — an instance can only be running the invocations it is
 *     running — and a slot held in Redis with no reliable release path leaks on
 *     every crash.
 *   - (4) is the one that guards money, so it is the one that fails closed when
 *     its store cannot answer.
 *
 * `docs/SECURITY_NOTES.md` §12 states exactly what each store does and does not
 * guarantee.
 */

import { LIMITS } from './config';
import { checkRateLimit } from './ratelimit';
import { redisConfigured } from './redis-rest';
import { consumeWindow, type WindowResult, type WindowStore } from './window';

export type AdmissionReason = 'window' | 'concurrency';

export interface AdmissionResult {
  allowed: boolean;
  reason: AdmissionReason | null;
  retryAfterSeconds: number;
  /** Requests left in this caller's window. */
  remaining: number;
  limit: number;
  /** Where the window counter this request was measured against lives. */
  store: WindowStore;
}

const inFlight = new Map<string, number>();

function memoryWindow(key: string, now: number): WindowResult {
  const window = checkRateLimit(key, now);
  return {
    allowed: window.allowed,
    remaining: window.remaining,
    limit: window.limit,
    retryAfterSeconds: window.retryAfterSeconds,
    store: 'memory',
  };
}

/**
 * The window, from whichever store this deployment has.
 *
 * A Redis failure degrades to the in-process counter rather than refusing the
 * request: this ceiling protects fairness, and the quota protects money. The
 * quota is charged further down the route and fails closed there, so an
 * unreachable Redis still cannot spend credits.
 */
async function takeWindow(key: string, now: number): Promise<WindowResult> {
  if (!redisConfigured()) return memoryWindow(key, now);
  try {
    return await consumeWindow(key, now);
  } catch {
    return memoryWindow(key, now);
  }
}

/**
 * Reserves one screening slot. A successful reservation must be paired with
 * `release()` in a `finally` block, or the caller's concurrency slot leaks.
 */
export async function admit(key: string, now = Date.now()): Promise<AdmissionResult> {
  const running = inFlight.get(key) ?? 0;

  if (running >= LIMITS.concurrentPerCaller) {
    return {
      allowed: false,
      reason: 'concurrency',
      retryAfterSeconds: 3,
      remaining: 0,
      limit: LIMITS.requestsPerWindow,
      store: windowStore(),
    };
  }

  const window = await takeWindow(key, now);
  if (!window.allowed) {
    return {
      allowed: false,
      reason: 'window',
      retryAfterSeconds: window.retryAfterSeconds,
      remaining: 0,
      limit: window.limit,
      store: window.store,
    };
  }

  inFlight.set(key, running + 1);

  return {
    allowed: true,
    reason: null,
    retryAfterSeconds: 0,
    remaining: window.remaining,
    limit: window.limit,
    store: window.store,
  };
}

export function release(key: string): void {
  const running = inFlight.get(key) ?? 0;
  if (running <= 1) inFlight.delete(key);
  else inFlight.set(key, running - 1);
}

/** Where the window counter is configured to live, for `/api/status`. */
export function windowStore(): WindowStore {
  return redisConfigured() ? 'redis' : 'memory';
}

/** Test hook. Never called by application code. */
export function resetAdmission(): void {
  inFlight.clear();
}
