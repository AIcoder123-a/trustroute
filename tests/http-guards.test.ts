import { beforeEach, describe, expect, it } from 'vitest';

import { POST as analyzePost } from '@/app/api/analyze/route';
import { POST as reviewPost } from '@/app/api/review/route';
import { GET as statusGet } from '@/app/api/status/route';
import { resetAdmission } from '@/lib/admission';
import { LIMITS } from '@/lib/config';
import { resetQuota } from '@/lib/quota';
import { checkRateLimit, resetRateLimit } from '@/lib/ratelimit';

function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://trustroute.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'trustroute.example', ...headers },
    body,
  });
}

/** A request whose body is a stream, so it carries no `content-length`. */
function streamed(path: string, chunks: string[]): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Request(`https://trustroute.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'trustroute.example' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
}

describe('HTTP guards on the public routes', () => {
  beforeEach(() => {
    resetRateLimit();
    resetAdmission();
    resetQuota();
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

  it('refuses an oversized streamed body that declares no length', async () => {
    // 12 × 64 KB with no `content-length`: the earlier header check cannot see
    // this one, so the bounded reader has to stop it.
    const chunk = 'a'.repeat(64 * 1024);
    const response = await analyzePost(streamed('/api/analyze', Array.from({ length: 12 }, () => chunk)));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe('payload_too_large');
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
    // The day's counter was never read, so the header is absent rather than wrong.
    expect(response.headers.get('X-Daily-Remaining')).toBeNull();
  });

  it('does not spend the day allowance on a request that never reached a detector', async () => {
    const rejected = await analyzePost(
      post('/api/analyze', JSON.stringify({ text: '   ', contentType: 'support_ticket' })),
    );
    expect(rejected.status).toBe(400);

    const accepted = await analyzePost(
      post('/api/analyze', JSON.stringify({ text: 'Please summarise this ticket.', contentType: 'support_ticket' })),
    );
    expect(accepted.status).toBe(200);
    // Exactly one screening was charged, not two.
    expect(accepted.headers.get('X-Daily-Remaining')).toBe(String(LIMITS.dailyScreens - 1));
  });

  it('publishes the limits and admits where the counters live, without the key', async () => {
    const body = (await (await statusGet()).json()) as Record<string, unknown>;
    const serialised = JSON.stringify(body);

    expect(body.admission).toEqual({
      store: 'memory',
      sharedAcrossInstances: false,
      window: { store: 'memory', sharedAcrossInstances: false },
      turnstile: 'off',
      trustProxy: false,
      platform: null,
    });
    expect((body.limits as Record<string, number>).dailyScreens).toBe(LIMITS.dailyScreens);
    expect(serialised).not.toMatch(/CLOCKED_API_KEY|bearer|api[_-]?key/i);
  });
});
