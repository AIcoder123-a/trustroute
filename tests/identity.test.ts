import { afterEach, describe, expect, it, vi } from 'vitest';

import { callerIdentity } from '@/lib/ratelimit';

function request(headers: Record<string, string>): Request {
  return new Request('https://trustroute.example/api/analyze', { method: 'POST', headers });
}

describe('caller identity', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('takes the address the proxy appended, not the one the client pre-seeded', () => {
    const identity = callerIdentity(
      request({ 'x-forwarded-for': '198.51.100.7, 203.0.113.9' }),
      { trustProxy: true },
    );
    expect(identity).toMatchObject({ key: '203.0.113.9', source: 'proxy' });
  });

  it('prefers the edge-written single-address header when present', () => {
    const identity = callerIdentity(
      request({ 'cf-connecting-ip': '203.0.113.10', 'x-forwarded-for': '198.51.100.7' }),
      { trustProxy: true },
    );
    expect(identity.source).toBe('proxy');
    expect(identity.key).toBe('203.0.113.10');
  });

  it('does not hand a client an unlimited number of identities by default', () => {
    const a = callerIdentity(request({ 'x-forwarded-for': '198.51.100.7' }));
    const b = callerIdentity(request({ 'x-forwarded-for': '198.51.100.7' }));
    const c = callerIdentity(request({ 'x-forwarded-for': '192.0.2.44' }));

    expect(a.source).toBe('claimed');
    expect(a.key).toMatch(/^claimed-\d+$/);
    expect(a.key).toBe(b.key);
    // Folding is a fairness partition, not proof: the same claimed address always
    // lands in the same bucket, and a different one usually lands in a different one.
    expect(c.key).not.toBe(a.key);
  });

  it('keeps every caller in one bucket when there is no address at all', () => {
    expect(callerIdentity(request({})).key).toBe('shared');
  });

  it("reads Netlify's own client-IP header when the deployment declares the platform", () => {
    vi.stubEnv('PLATFORM', 'netlify');
    // Netlify's guidance is that X-Forwarded-For carries CDN node addresses, so a
    // last-hop read there would put every visitor in a handful of buckets.
    const identity = callerIdentity(
      request({
        'x-nf-client-connection-ip': '203.0.113.77',
        'x-forwarded-for': '198.51.100.7, 10.0.0.4',
      }),
      { trustProxy: true },
    );
    expect(identity).toMatchObject({ key: '203.0.113.77', source: 'proxy' });
  });

  it('ignores that header when the platform was never declared', () => {
    // Ungated, the header would be spoofable on any other host: a client that
    // sets it per request would manufacture unlimited buckets.
    const identity = callerIdentity(
      request({ 'x-nf-client-connection-ip': '203.0.113.77', 'x-forwarded-for': '198.51.100.7' }),
      { trustProxy: true },
    );
    expect(identity.key).toBe('198.51.100.7');
  });
});
