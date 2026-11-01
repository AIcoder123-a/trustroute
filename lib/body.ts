/**
 * A bounded body reader.
 *
 * `request.text()` reads whatever the client sends. On a 512 MB free instance a
 * chunked POST with no `content-length` is therefore a memory amplifier: the
 * route's earlier size check only sees a header the client is free to omit.
 * Reading the stream ourselves costs one loop and makes the ceiling real —
 * `maxBodyBytes` is the most the process will ever hold for one request.
 *
 * The stream is cancelled as soon as the limit is crossed, so the rest of an
 * oversized upload is never buffered and never parsed.
 */

import { LIMITS } from './config';

export type BodyRead =
  | { ok: true; text: string }
  | { ok: false; reason: 'too_large' | 'unreadable'; bytes: number };

const decoder = new TextDecoder('utf-8');

export async function readBoundedBody(
  request: Request,
  maxBytes: number = LIMITS.maxBodyBytes,
): Promise<BodyRead> {
  const body = request.body;

  // No body at all: an empty string is the honest reading, and JSON.parse in the
  // caller turns it into a 400 rather than a 500.
  if (body === null) return { ok: true, text: '' };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      bytes += value.byteLength;
      if (bytes > maxBytes) {
        // Stop pulling: the connection can be dropped from here.
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'too_large', bytes };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'unreadable', bytes };
  }

  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: decoder.decode(buffer) };
}
