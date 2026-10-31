/**
 * Admission control for the public screening route.
 *
 * Three independent ceilings, because they fail in different ways:
 *
 *   1. **Per caller, per window** (`lib/ratelimit.ts`) — one visitor pressing
 *      the button in a loop.
 *   2. **Per caller, concurrent** — one visitor opening ten tabs. Ten parallel
 *      screens cost the same credits as ten sequential ones, but they also run
 *      ten model calls at once, which is how a free demo trips a concurrency
 *      limit at the provider.
 *   3. **Whole deployment, per UTC day** — the credit balance. Per-IP limits do
 *      nothing against a hundred IPs, and this is the only ceiling that bounds
 *      what the account can be charged in a day.
 *
 * In-process memory, like the audit trail: honest for a single-instance demo,
 * insufficient for a fleet. `docs/SECURITY_NOTES.md` §6 states the limitation.
 */

import { LIMITS } from './config';
import { checkRateLimit } from './ratelimit';

export type AdmissionReason = 'window' | 'concurrency' | 'daily_budget';

export interface AdmissionResult {
  allowed: boolean;
  reason: AdmissionReason | null;
  retryAfterSeconds: number;
  /** Requests left in this caller's window. */
  remaining: number;
  limit: number;
  /** Screens left in the deployment's day. Never negative. */
  dailyRemaining: number;
}

let day = '';
let spentToday = 0;
const inFlight = new Map<string, number>();

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(now: number): number {
  const next = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now) / 1000));
}

/**
 * Reserve one screening. A successful reservation must be paired with
 * `release()` in a `finally` block, or the caller's concurrency slot leaks.
 */
export function admit(key: string, now = Date.now()): AdmissionResult {
  const today = utcDay(now);
  if (today !== day) {
    day = today;
    spentToday = 0;
  }

  const base = {
    remaining: 0,
    limit: LIMITS.requestsPerWindow,
    dailyRemaining: Math.max(0, LIMITS.dailyScreens - spentToday),
  };

  if (spentToday >= LIMITS.dailyScreens) {
    return {
      ...base,
      allowed: false,
      reason: 'daily_budget',
      retryAfterSeconds: secondsUntilUtcMidnight(now),
    };
  }

  const running = inFlight.get(key) ?? 0;
  if (running >= LIMITS.concurrentPerCaller) {
    return { ...base, allowed: false, reason: 'concurrency', retryAfterSeconds: 3 };
  }

  // Last, because this call mutates the window.
  const window = checkRateLimit(key, now);
  if (!window.allowed) {
    return {
      ...base,
      allowed: false,
      reason: 'window',
      retryAfterSeconds: window.retryAfterSeconds,
    };
  }

  spentToday += 1;
  inFlight.set(key, running + 1);

  return {
    allowed: true,
    reason: null,
    retryAfterSeconds: 0,
    remaining: window.remaining,
    limit: window.limit,
    dailyRemaining: Math.max(0, LIMITS.dailyScreens - spentToday),
  };
}

export function release(key: string): void {
  const running = inFlight.get(key) ?? 0;
  if (running <= 1) inFlight.delete(key);
  else inFlight.set(key, running - 1);
}

/** Test hook. Never called by application code. */
export function resetAdmission(): void {
  day = '';
  spentToday = 0;
  inFlight.clear();
}
