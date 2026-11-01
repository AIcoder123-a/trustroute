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

/**
 * Where a caller's rate-limit key comes from, and how much that key can be
 * trusted. The distinction matters: `x-forwarded-for` is a request header, so a
 * direct connection can put anything in it, and a client that rotates a fake IP
 * per request would get an unlimited number of buckets.
 */
export type IdentitySource = 'proxy' | 'claimed' | 'shared';

export interface CallerIdentity {
  /** The bucket key handed to the window and concurrency counters. */
  key: string;
  source: IdentitySource;
  /** The address as presented. Never used as proof of anything. */
  ip: string | null;
}

/** Claimed addresses are folded into this many buckets unless a proxy is trusted. */
const CLAIMED_BUCKETS = 64;

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The address Netlify's CDN saw, when this deployment is declared to be on
 * Netlify.
 *
 * Netlify's own guidance is explicit that `x-forwarded-for` must not be used to
 * identify a visitor on their platform — the hops it carries include CDN node
 * addresses — and that `x-nf-client-connection-ip` is the header to read. Left
 * ungated that header would be a spoofing hole anywhere else, so it is read only
 * when the deployment says which platform it is on (`PLATFORM=netlify`).
 */
function netlifyClientIp(request: Request): string | null {
  if ((process.env.PLATFORM ?? '').trim().toLowerCase() !== 'netlify') return null;
  return request.headers.get('x-nf-client-connection-ip')?.trim() ?? null;
}

/**
 * Resolves the caller bucket.
 *
 *   - `TRUST_PROXY=1` and an edge header present → the address the edge wrote.
 *     Precedence is by specificity: an edge that terminates the connection and
 *     overwrites its own header is the most specific source available, so
 *     `cf-connecting-ip` wins, then `x-nf-client-connection-ip`, then the **last**
 *     `x-forwarded-for` hop — last, because a proxy appends the address it saw
 *     and a client can only pre-seed the beginning of the list.
 *   - otherwise → the claimed address, folded into a fixed set of buckets so a
 *     client cannot manufacture unlimited identities by inventing addresses. It
 *     is a fairness partition, not a security boundary; the ceilings that bound
 *     spending are the daily quota and the Turnstile gate.
 */
export function callerIdentity(request: Request, options: { trustProxy?: boolean } = {}): CallerIdentity {
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === '1';

  const forwarded = request.headers.get('x-forwarded-for');
  const hops = forwarded ? forwarded.split(',').map((hop) => hop.trim()).filter(Boolean) : [];
  const claimed =
    request.headers.get('cf-connecting-ip')?.trim() ??
    netlifyClientIp(request) ??
    hops[hops.length - 1] ??
    request.headers.get('x-real-ip')?.trim() ??
    null;

  if (!claimed) return { key: 'shared', source: 'shared', ip: null };
  if (trustProxy) return { key: claimed, source: 'proxy', ip: claimed };
  return { key: `claimed-${fnv1a(claimed) % CLAIMED_BUCKETS}`, source: 'claimed', ip: claimed };
}

/** The bucket key alone, for callers that do not need the provenance. */
export function callerKey(request: Request): string {
  return callerIdentity(request).key;
}

/** Test hook — never called by application code. */
export function resetRateLimit(): void {
  windows.clear();
  lastSweep = Date.now();
}
