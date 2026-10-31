/**
 * Same-origin enforcement for the two state-changing routes.
 *
 * The public demo spends real credits on every screening, so a request that a
 * stranger's web page triggered in a visitor's browser must not be honoured.
 * A browser always attaches `Origin` to a cross-site POST, which makes the
 * check sufficient for CSRF without a token:
 *
 *   - `Origin` missing        → not a browser-initiated cross-site request
 *                               (curl, a server-side script, a same-origin GET).
 *                               Accepted: blocking it would break operational
 *                               verification while removing no real protection.
 *   - `Origin: null`          → an opaque origin: a sandboxed iframe, a
 *                               `data:` document, a redirect chain. Refused.
 *   - `Origin` host ≠ Host    → refused, unless the origin is listed in
 *                               `ALLOWED_ORIGINS` (comma-separated), which is
 *                               how a reverse proxy with a different public
 *                               name is accommodated without weakening the app.
 *
 * This is deliberately not a CORS configuration: no `Access-Control-Allow-*`
 * header is ever emitted, so a cross-origin page cannot read a response even
 * if it manages to send one.
 */

const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.length > 0);

export type OriginCheck =
  | { ok: true }
  | { ok: false; reason: 'opaque_origin' | 'cross_origin' | 'unparsable_origin' };

function normalise(origin: string): string | null {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

export function checkOrigin(request: Request): OriginCheck {
  const raw = request.headers.get('origin');
  if (raw === null) return { ok: true };
  if (raw.trim().toLowerCase() === 'null') return { ok: false, reason: 'opaque_origin' };

  const origin = normalise(raw);
  const originHost = hostOf(raw);
  if (origin === null || originHost === null) return { ok: false, reason: 'unparsable_origin' };

  if (ALLOWED.includes(origin)) return { ok: true };

  // Behind a TLS terminator the request URL is http while the browser's Origin
  // is https, so compare hosts rather than full origins.
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (forwardedHost !== null && forwardedHost.split(',')[0]?.trim().toLowerCase() === originHost) {
    return { ok: true };
  }

  return { ok: false, reason: 'cross_origin' };
}
