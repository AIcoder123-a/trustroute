/**
 * Cloudflare Turnstile, verified server-side.
 *
 * Turnstile is the cheapest way to make a public demo cost money only for
 * visitors who are actually using it: verification is free and unlimited, needs
 * no shared state of our own, and the token cannot be forged client-side. The
 * widget hands the browser a token; this module asks Cloudflare whether that
 * token is genuine before a single Clocked credit is spent.
 *
 * Three things are deliberately strict here:
 *
 *   1. **The token never stands in for identity.** It proves "a human completed a
 *      challenge in the last five minutes", nothing about who they are or where
 *      they connected from. Caller identity stays a separate question.
 *   2. **Replay is refused before verification.** A token is single-use at
 *      Cloudflare, but two concurrent replays can both reach `siteverify` before
 *      either is burned. The claim below closes that window; with Redis
 *      configured the claim is shared by every instance.
 *   3. **An unreachable verifier is a refusal.** If clocked credits are at stake,
 *      "we could not check" must not be treated as "probably fine".
 *
 * Off by default: without `TURNSTILE_ENABLED=true` and a secret, this module
 * reports `disabled` and the route behaves exactly as it did before.
 */

import { redisCommand, redisConfigured } from './redis-rest';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Cloudflare tokens are valid for 300 seconds; the claim lives exactly as long. */
const CLAIM_TTL_MS = 300_000;
const CLAIM_TTL_SECONDS = 300;
/** Upper bound on the in-process claim table, so a flood cannot grow it forever. */
const CLAIM_CAPACITY = 5_000;

export type TurnstileReason =
  | 'ok'
  | 'disabled'
  | 'missing_token'
  | 'replayed'
  | 'rejected'
  | 'verifier_unavailable'
  | 'misconfigured';

export interface TurnstileResult {
  ok: boolean;
  reason: TurnstileReason;
  /** Cloudflare's error codes, when it answered with a refusal. */
  codes: string[];
  /** True when the result came from the local replay guard rather than a network call. */
  replayed: boolean;
}

export interface TurnstileConfig {
  enabled: boolean;
  secret: string;
  siteKey: string;
}

export function turnstileConfig(): TurnstileConfig {
  const enabled = (process.env.TURNSTILE_ENABLED ?? '').trim().toLowerCase() === 'true';
  return {
    enabled,
    secret: process.env.TURNSTILE_SECRET?.trim() ?? '',
    siteKey: process.env.TURNSTILE_SITE_KEY?.trim() ?? '',
  };
}

const claims = new Map<string, number>();

function sweep(now: number): void {
  if (claims.size < CLAIM_CAPACITY) return;
  for (const [token, expiry] of claims) {
    if (expiry <= now) claims.delete(token);
  }
  // Still full of live claims: drop the oldest half rather than grow without bound.
  if (claims.size >= CLAIM_CAPACITY) {
    const keep = [...claims.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.floor(CLAIM_CAPACITY / 2));
    claims.clear();
    for (const [token, expiry] of keep) claims.set(token, expiry);
  }
}

/** SHA-256 of the token, so the table never holds a usable credential. */
async function fingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Claims a token for single use. Returns false when it has already been seen —
 * including on another instance, when Redis is configured.
 */
async function claim(token: string, now: number, fetchImpl?: typeof fetch): Promise<boolean> {
  const id = await fingerprint(token);

  if (redisConfigured()) {
    try {
      const result = await redisCommand({
        command: ['SET', `trustroute:turnstile:${id}`, '1', 'NX', 'PX', CLAIM_TTL_SECONDS * 1000],
        op: 'turnstile',
        fetchImpl,
      });
      // `SET … NX` answers 'OK' when the key was created, null when it existed.
      return result === 'OK';
    } catch {
      // The claim store is the gate in front of the credits: if it is down, the
      // caller below treats this as a refusal rather than a free pass.
      throw new Error('replay store unavailable');
    }
  }

  sweep(now);
  const seen = claims.get(id);
  if (seen !== undefined && seen > now) return false;
  claims.set(id, now + CLAIM_TTL_MS);
  return true;
}

function releaseClaim(token: string): void {
  // Only used when the verifier could not answer, so a still-valid token is not
  // burned by an outage on our side.
  if (claims.size === 0) return;
  void fingerprint(token).then((id) => claims.delete(id));
}

export interface VerifyOptions {
  /** Caller address, forwarded to Cloudflare for its own risk decision. */
  remoteIp?: string | null;
  now?: number;
  fetchImpl?: typeof fetch;
  config?: TurnstileConfig;
  timeoutMs?: number;
}

/**
 * Verifies one token. Never throws: every failure mode is a `TurnstileResult`
 * whose `ok` is false, so the caller cannot accidentally fall through on an
 * exception.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  options: VerifyOptions = {},
): Promise<TurnstileResult> {
  const config = options.config ?? turnstileConfig();
  if (!config.enabled) return { ok: false, reason: 'disabled', codes: [], replayed: false };
  if (!config.secret) return { ok: false, reason: 'misconfigured', codes: [], replayed: false };

  const trimmed = token?.trim();
  if (!trimmed) return { ok: false, reason: 'missing_token', codes: [], replayed: false };

  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;

  let claimed: boolean;
  try {
    claimed = await claim(trimmed, now, fetchImpl);
  } catch {
    return { ok: false, reason: 'verifier_unavailable', codes: [], replayed: false };
  }
  if (!claimed) return { ok: false, reason: 'replayed', codes: [], replayed: true };

  const form = new URLSearchParams({ secret: config.secret, response: trimmed });
  if (options.remoteIp) form.set('remoteip', options.remoteIp);

  let payload: { success?: boolean; 'error-codes'?: string[] };
  try {
    const response = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs ?? 4000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    payload = (await response.json()) as { success?: boolean; 'error-codes'?: string[] };
  } catch {
    releaseClaim(trimmed);
    return { ok: false, reason: 'verifier_unavailable', codes: [], replayed: false };
  }

  if (payload.success === true) return { ok: true, reason: 'ok', codes: [], replayed: false };
  return { ok: false, reason: 'rejected', codes: payload['error-codes'] ?? [], replayed: false };
}

/** Test hook. Never called by application code. */
export function resetTurnstileClaims(): void {
  claims.clear();
}
