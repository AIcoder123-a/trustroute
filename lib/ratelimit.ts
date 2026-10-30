/**
 * Best-effort abuse control for the public demo.
 *
 * A fixed-window counter in process memory. It is honest about what it is: on a
 * multi-instance deployment each instance keeps its own window, and a restart
 * clears it. For a challenge demo that is proportionate; for production you
 * would put this in Redis or at the edge. See docs/SECURITY_NOTES.md.
 */

import { LIMITS } from './config';

const windows = new Map<string, number[]>();
let lastSweep = Date.now();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
}

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  if (now - lastSweep > LIMITS.windowMs) {
    for (const [candidate, stamps] of windows) {
      if (stamps.every((stamp) => now - stamp > LIMITS.windowMs)) windows.delete(candidate);
    }
    lastSweep = now;
  }

  const stamps = (windows.get(key) ?? []).filter((stamp) => now - stamp < LIMITS.windowMs);
  if (stamps.length >= LIMITS.requestsPerWindow) {
    const oldest = stamps[0] ?? now;
    windows.set(key, stamps);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((LIMITS.windowMs - (now - oldest)) / 1000)),
      limit: LIMITS.requestsPerWindow,
    };
  }

  stamps.push(now);
  windows.set(key, stamps);
  return {
    allowed: true,
    remaining: LIMITS.requestsPerWindow - stamps.length,
    retryAfterSeconds: 0,
    limit: LIMITS.requestsPerWindow,
  };
}

export function callerKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  // Local development and single-tenant demos share a bucket.
  return 'local';
}

/** Test hook — never called by application code. */
export function resetRateLimit(): void {
  windows.clear();
  lastSweep = Date.now();
}
