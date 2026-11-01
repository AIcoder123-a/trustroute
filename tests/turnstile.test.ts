import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTurnstileClaims, verifyTurnstile, type TurnstileConfig } from '@/lib/turnstile';

const ON: TurnstileConfig = { enabled: true, secret: 'test-secret', siteKey: 'test-site-key' };
const NOW = Date.UTC(2026, 10, 1, 10, 0, 0);

function verifier(payload: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('Turnstile verification', () => {
  beforeEach(() => {
    resetTurnstileClaims();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetTurnstileClaims();
  });

  it('is off unless explicitly enabled', async () => {
    const result = await verifyTurnstile('token', { config: { enabled: false, secret: '', siteKey: '' } });
    expect(result).toMatchObject({ ok: false, reason: 'disabled' });
  });

  it('refuses everything when enabled without a secret', async () => {
    const result = await verifyTurnstile('token', { config: { enabled: true, secret: '', siteKey: 'k' } });
    expect(result).toMatchObject({ ok: false, reason: 'misconfigured' });
  });

  it('refuses a request with no token before calling Cloudflare', async () => {
    const fetchImpl = verifier({ success: true });
    const result = await verifyTurnstile('   ', { config: ON, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, reason: 'missing_token' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a token Cloudflare confirms, and sends the secret only server-side', async () => {
    const fetchImpl = verifier({ success: true });
    const result = await verifyTurnstile('good-token', {
      config: ON,
      now: NOW,
      remoteIp: '203.0.113.9',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ ok: true, reason: 'ok' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('test-secret');
    expect(body.get('response')).toBe('good-token');
    expect(body.get('remoteip')).toBe('203.0.113.9');
  });

  it('surfaces Cloudflare error codes on a refusal', async () => {
    const fetchImpl = verifier({ success: false, 'error-codes': ['invalid-input-response'] });
    const result = await verifyTurnstile('stale', {
      config: ON,
      now: NOW,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('rejected');
    expect(result.codes).toEqual(['invalid-input-response']);
  });

  it('refuses a replayed token without a second verification call', async () => {
    const fetchImpl = verifier({ success: true });
    const first = await verifyTurnstile('same-token', {
      config: ON,
      now: NOW,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const second = await verifyTurnstile('same-token', {
      config: ON,
      now: NOW + 1_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: 'replayed', replayed: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the verifier is unreachable, and does not burn the token', async () => {
    const down = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    const first = await verifyTurnstile('retryable', {
      config: ON,
      now: NOW,
      fetchImpl: down as unknown as typeof fetch,
    });
    expect(first).toMatchObject({ ok: false, reason: 'verifier_unavailable' });

    // The claim made before the outage is released, so a retry with the same
    // still-valid token is allowed through to the verifier again.
    const up = verifier({ success: true });
    const second = await verifyTurnstile('retryable', {
      config: ON,
      now: NOW + 2_000,
      fetchImpl: up as unknown as typeof fetch,
    });
    expect(second.ok).toBe(true);
  });

  it('fails closed on a non-200 from siteverify', async () => {
    const fetchImpl = verifier({ success: true }, 502);
    const result = await verifyTurnstile('token', {
      config: ON,
      now: NOW,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false, reason: 'verifier_unavailable' });
  });

  it('shares the replay claim across instances when Redis is configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');

    // `SET … NX` answers null when the key already existed — another instance,
    // or an earlier request, has claimed this token.
    const redis = vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 }));
    const result = await verifyTurnstile('token', {
      config: ON,
      now: NOW,
      fetchImpl: redis as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, reason: 'replayed' });
    const [, init] = redis.mock.calls[0] as unknown as [string, RequestInit];
    const command = JSON.parse(String(init.body)) as Array<string | number>;
    expect(command.slice(0, 2)).toEqual(['SET', expect.stringContaining('trustroute:turnstile:')]);
    // The token itself is never stored — only its SHA-256 fingerprint.
    expect(String(command[1])).not.toContain('token');
  });
});
