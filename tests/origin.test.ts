import { describe, expect, it } from 'vitest';

import { checkOrigin } from '@/lib/origin';

function request(headers: Record<string, string>): Request {
  return new Request('https://trustroute.example/api/analyze', { method: 'POST', headers });
}

describe('same-origin enforcement', () => {
  it('accepts a request with no Origin header', () => {
    // curl, a health check, or the harness: not a browser-initiated cross-site
    // request, so there is no ambient credential for a third party to borrow.
    expect(checkOrigin(request({ host: 'trustroute.example' })).ok).toBe(true);
  });

  it('accepts the application origin itself', () => {
    const decision = checkOrigin(request({ host: 'trustroute.example', origin: 'https://trustroute.example' }));
    expect(decision.ok).toBe(true);
  });

  it('accepts the forwarded host behind a TLS terminator', () => {
    const decision = checkOrigin(
      request({
        host: '10.0.0.4:3000',
        'x-forwarded-host': 'demo.example',
        origin: 'https://demo.example',
      }),
    );
    expect(decision.ok).toBe(true);
  });

  it('refuses another site posting from a visitor’s browser', () => {
    const decision = checkOrigin(request({ host: 'trustroute.example', origin: 'https://evil.example' }));
    expect(decision).toEqual({ ok: false, reason: 'cross_origin' });
  });

  it('refuses an opaque origin', () => {
    // Sandboxed iframes and data: documents report this; it is what an injected
    // frame would use.
    const decision = checkOrigin(request({ host: 'trustroute.example', origin: 'null' }));
    expect(decision).toEqual({ ok: false, reason: 'opaque_origin' });
  });

  it('refuses an unparsable Origin rather than trusting it', () => {
    const decision = checkOrigin(request({ host: 'trustroute.example', origin: 'not a url' }));
    expect(decision).toEqual({ ok: false, reason: 'unparsable_origin' });
  });
});
