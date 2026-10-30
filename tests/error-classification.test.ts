import { describe, expect, it } from 'vitest';

import { AuthenticationError, ConnectionError, PermissionDeniedError, RequestTimeoutError } from 'clocked-sdk';

import { classifyError } from '@/lib/clocked/live';

function details(status: number | null, error: string) {
  return { status, error, idempotencyKey: 'test-key', attempts: 1 };
}

const CLOUDFLARE_PAGE =
  '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta name="robots" content="noindex,nofollow">' +
  '<script>window._cf_chl_opt={cvId:"3"}</script></head><body>Checking your browser before accessing the site.</body></html>';

describe('classifyError', () => {
  it('does not call an HTML interstitial a credential problem', () => {
    const result = classifyError(new PermissionDeniedError(details(403, CLOUDFLARE_PAGE)));
    expect(result.error.code).toBe('edge_interstitial');
    expect(result.status).toBe('error');
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/HTML page instead of a JSON result/i);
    // The HTML never reaches the UI.
    expect(result.error.message).not.toContain('<');
    expect(result.error.message.length).toBeLessThan(400);
  });

  it('recognises a genuine rejected key', () => {
    const result = classifyError(new AuthenticationError(details(401, 'Invalid API key.')));
    expect(result.status).toBe('unauthorized');
    expect(result.error.code).toBe('unauthorized');
    expect(result.error.retryable).toBe(false);
  });

  it('recognises a genuine permission error', () => {
    const result = classifyError(new PermissionDeniedError(details(403, 'Plan does not include this endpoint.')));
    expect(result.status).toBe('unauthorized');
    expect(result.error.code).toBe('forbidden');
  });

  it('marks timeouts as retryable with an unknown outcome', () => {
    const result = classifyError(new RequestTimeoutError(details(null, 'timed out')));
    expect(result.status).toBe('timeout');
    expect(result.error.retryable).toBe(true);
  });

  it('separates connection failures from API rejections', () => {
    const result = classifyError(new ConnectionError(details(null, 'fetch failed')));
    expect(result.status).toBe('error');
    expect(result.error.code).toBe('connection');
  });

  it('never throws on an unknown error shape', () => {
    const result = classifyError(new Error('boom'));
    expect(result.status).toBe('error');
    expect(result.error.code).toBe('unknown');
  });
});
