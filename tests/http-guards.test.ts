import { beforeEach, describe, expect, it } from 'vitest';

import { POST as analyzePost } from '@/app/api/analyze/route';
import { POST as reviewPost } from '@/app/api/review/route';
import { GET as statusGet } from '@/app/api/status/route';
import { resetAdmission } from '@/lib/admission';
import { LIMITS } from '@/lib/config';
import { checkRateLimit, resetRateLimit } from '@/lib/ratelimit';

function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://trustroute.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'trustroute.example', ...headers },
    body,
  });
}

describe('HTTP guards on the public routes', () => {
  beforeEach(() => {
    resetRateLimit();
    resetAdmission();
  });

  it('refuses a screening requested by another site', async () => {
    const response = await analyzePost(
      post('/api/analyze', JSON.stringify({ text: 'hello', contentType: 'support_ticket' }), {
        origin: 'https://evil.example',
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('cross_origin_blocked');
  });

  it('refuses a review requested by another site', async () => {
    const response = await reviewPost(
      post('/api/review', '{}', { origin: 'https://evil.example' }),
    );
    expect(response.status).toBe(403);
  });

  it('refuses a body larger than the demo accepts, without parsing it', async () => {
    const response = await analyzePost(
      post('/api/analyze', '{}', { 'content-length': String(LIMITS.maxBodyBytes + 1) }),
    );
    expect(response.status).toBe(413);
  });

  it('rejects malformed JSON with a 400, not a 500', async () => {
    const response = await analyzePost(post('/api/analyze', '{not json'));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_json');
  });

  it('rejects a request with no text', async () => {
    const response = await analyzePost(post('/api/analyze', JSON.stringify({ contentType: 'support_ticket' })));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_input');
  });

  it('answers 429 once the caller has used its window', async () => {
    // No edge headers in this request, so the caller lands in the shared bucket.
    for (let index = 0; index < LIMITS.requestsPerWindow; index += 1) checkRateLimit('shared');
    const response = await analyzePost(post('/api/analyze', JSON.stringify({ text: 'x', contentType: 'support_ticket' })));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).not.toBeNull();
  });

  it('publishes the limits and admits where the counters live, without the key', async () => {
    const body = (await (await statusGet()).json()) as Record<string, unknown>;
    const serialised = JSON.stringify(body);

    expect(body.admission).toEqual({
      store: 'memory',
      sharedAcrossInstances: false,
      turnstile: 'off',
      trustProxy: false,
    });
    expect((body.limits as Record<string, number>).dailyScreens).toBe(LIMITS.dailyScreens);
    expect(serialised).not.toMatch(/CLOCKED_API_KEY|bearer|api[_-]?key/i);
  });
});
