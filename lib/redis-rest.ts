/**
 * Minimal REST client for a Redis-compatible endpoint (Upstash, or any host that
 * speaks the same single-command JSON protocol).
 *
 * Why REST and not a Redis client: the free tiers this demo can use expose an
 * HTTPS endpoint with a bearer token, and a `fetch` call has no connection pool
 * to leak in a short-lived serverless invocation. The whole surface this project
 * needs is four commands, so the client is a hundred lines rather than a
 * dependency.
 *
 * Nothing here is active unless `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` are both set. See docs/DEPLOYMENT.md §5.2.
 *
 * ── Why every failure has a code ────────────────────────────────────────────
 * The first live deployment answered every Redis problem with the same opaque
 * 503, and the only way to tell "wrong URL" from "wrong token" from "timeout"
 * was to guess, because the `catch` that produced it discarded the reason. The
 * codes below are that missing sentence. They are a closed set, and the log line
 * built from them carries no URL, token, script, command argument or caller
 * content — a production log is not a safe place for any of those and none of
 * them is needed to tell the five failure modes apart.
 */

export type RedisFailureCode =
  | 'redis_not_configured'
  | 'redis_bad_url'
  | 'redis_timeout'
  | 'redis_network'
  | 'redis_http_401'
  | 'redis_http_403'
  | 'redis_http_4xx'
  | 'redis_http_5xx'
  | 'redis_body_error'
  | 'redis_unreadable_body'
  | 'redis_bad_shape';

/** Which counter the call belongs to — the "stage" in the failure line. */
export type RedisOp = 'quota' | 'window' | 'turnstile' | 'unknown';

export class RedisCallError extends Error {
  readonly code: RedisFailureCode;
  /** HTTP status, when the failure had one. Never a response body. */
  readonly status: number | null;

  constructor(code: RedisFailureCode, status: number | null = null) {
    super(code);
    this.name = 'RedisCallError';
    this.code = code;
    this.status = status;
  }
}

export class RedisNotConfiguredError extends RedisCallError {
  constructor() {
    super('redis_not_configured');
    this.name = 'RedisNotConfiguredError';
  }
}

export interface RedisCall {
  /** Redis command as an array, e.g. `['INCR', 'key']`. */
  command: Array<string | number>;
  /** Which counter this is, so the failure line names the stage. */
  op?: RedisOp;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Emits exactly one line per failed call. Fixed keys, closed-set values.
 *
 * Deliberately a plain string rather than an object: Netlify prints function
 * logs as text, and a fixed `key=value` shape is what makes them greppable
 * afterwards.
 */
export function logRedisFailure(
  code: RedisFailureCode,
  op: RedisOp = 'unknown',
  status: number | null = null,
  startedAt?: number,
): void {
  const ms = typeof startedAt === 'number' ? Date.now() - startedAt : null;
  // The single intentional write in this codebase; see the header.
  console.warn(
    `[trustroute] redis failure code=${code} op=${op} status=${status ?? 'none'} ms=${ms ?? 'unknown'}`,
  );
}

/**
 * A value pasted from a console sometimes arrives wrapped in quotes, and
 * `"https://…"` is not a URL. Unwrapping only ever touches a value that is
 * already unusable as one, so a legitimate URL is returned unchanged.
 */
const WRAPPED_IN_QUOTES = /^(["'`])([\s\S]*)\1$/;

function unwrap(value: string): string {
  const match = WRAPPED_IN_QUOTES.exec(value);
  if (!match) return value;
  return (match[2] ?? '').trim();
}

function normalize(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? '' : unwrap(trimmed);
}

function credentials(): { url: string; token: string } | null {
  const url = normalize(process.env.UPSTASH_REDIS_REST_URL);
  const token = normalize(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

export function redisConfigured(): boolean {
  return credentials() !== null;
}

/** `true` when the configured value would actually be fetchable. */
export function redisEndpointValid(): boolean {
  const config = credentials();
  return config !== null && isHttpEndpoint(config.url);
}

function isHttpEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // `AbortSignal.timeout()` rejects with a TimeoutError; a caller-supplied
  // signal rejects with AbortError. Both mean the same thing here.
  return error.name === 'TimeoutError' || error.name === 'AbortError';
}

function httpCode(status: number): RedisFailureCode {
  if (status === 401) return 'redis_http_401';
  if (status === 403) return 'redis_http_403';
  return status >= 500 ? 'redis_http_5xx' : 'redis_http_4xx';
}

/**
 * Runs one command and returns its `result`. Throws on anything that is not a
 * clean `{ result: … }` — the callers are all fail-closed, so an ambiguous
 * answer must be an error rather than a guess.
 */
export async function redisCommand({
  command,
  op = 'unknown',
  fetchImpl = fetch,
  timeoutMs = 3000,
}: RedisCall): Promise<unknown> {
  const config = credentials();
  if (!config) throw new RedisNotConfiguredError();

  const startedAt = Date.now();

  if (!isHttpEndpoint(config.url)) {
    logRedisFailure('redis_bad_url', op, null, startedAt);
    throw new RedisCallError('redis_bad_url');
  }

  let response: Response;
  try {
    response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (error) {
    const code: RedisFailureCode = isTimeout(error) ? 'redis_timeout' : 'redis_network';
    logRedisFailure(code, op, null, startedAt);
    throw new RedisCallError(code);
  }

  if (!response.ok) {
    const code = httpCode(response.status);
    logRedisFailure(code, op, response.status, startedAt);
    throw new RedisCallError(code, response.status);
  }

  let payload: { result?: unknown; error?: string };
  try {
    payload = (await response.json()) as { result?: unknown; error?: string };
  } catch {
    // A 200 that is not JSON is what a captive portal or a proxy block page
    // looks like, and it must not be mistaken for an empty answer.
    logRedisFailure('redis_unreadable_body', op, response.status, startedAt);
    throw new RedisCallError('redis_unreadable_body', response.status);
  }

  // Upstash can answer 200 and still report a command error in the body, so the
  // status code alone is not the verdict. Both shapes are checked.
  if (typeof payload.error === 'string') {
    logRedisFailure('redis_body_error', op, response.status, startedAt);
    throw new RedisCallError('redis_body_error', response.status);
  }
  if (!('result' in payload)) {
    logRedisFailure('redis_bad_shape', op, response.status, startedAt);
    throw new RedisCallError('redis_bad_shape', response.status);
  }
  return payload.result;
}
