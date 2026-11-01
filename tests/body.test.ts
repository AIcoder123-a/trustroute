import { describe, expect, it } from 'vitest';

import { readBoundedBody } from '@/lib/body';

/**
 * A request whose body is a stream and therefore carries no `content-length` —
 * the shape a client uses when it wants the server to buffer without limit.
 */
function streamed(chunks: string[]): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Request('https://trustroute.example/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
}

describe('bounded body reader', () => {
  it('reads a body that fits', async () => {
    const result = await readBoundedBody(streamed(['{"text":', '"hello"}']), 64);
    expect(result).toEqual({ ok: true, text: '{"text":"hello"}' });
  });

  it('accepts a body exactly at the limit', async () => {
    const result = await readBoundedBody(streamed(['abcd']), 4);
    expect(result.ok).toBe(true);
  });

  it('refuses the first byte over the limit instead of buffering the rest', async () => {
    const result = await readBoundedBody(streamed(['abcd', 'e', 'fghij']), 4);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('too_large');
    // Five bytes were seen before the reader stopped pulling.
    expect(result.bytes).toBe(5);
  });

  it('treats an absent body as empty rather than as an error', async () => {
    const request = new Request('https://trustroute.example/api/analyze', { method: 'POST' });
    expect(await readBoundedBody(request, 64)).toEqual({ ok: true, text: '' });
  });

  it('decodes multi-byte characters split across chunks', async () => {
    // "é" is two bytes in UTF-8; splitting it across chunks must not corrupt it.
    const encoder = new TextEncoder();
    const bytes = encoder.encode('é');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        controller.enqueue(bytes.slice(1));
        controller.close();
      },
    });
    const request = new Request('https://trustroute.example/api/analyze', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(await readBoundedBody(request, 64)).toEqual({ ok: true, text: 'é' });
  });
});
