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
});
