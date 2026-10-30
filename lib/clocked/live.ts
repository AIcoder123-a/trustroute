/**
 * LIVE ADAPTER — real Clocked API calls.
 *
 * Server-only. The API key is read from the environment inside the request
 * handler and never leaves this process: it is not embedded in a payload, not
 * logged, and not returned to the browser.
 *
 * Calls go through the official `clocked-sdk`, which owns the Idempotency-Key,
 * the bounded retry policy and the timeout budget per attempt.
 */

import {
  AuthenticationError,
  Clocked,
  ClockedError,
  ConnectionError,
  InsufficientCreditsError,
  PermissionDeniedError,
  RateLimitError,
  RequestTimeoutError,
  ValidationError,
} from 'clocked-sdk';

import { ConfigurationError, hasApiKey } from '../config';
import type { GuardData, InspectData, ProtectData, StageError, StageStatus } from '../types';
import { normalizeGuard, normalizeInspect, normalizeProtect } from './normalize';

let client: Clocked | null = null;

function getClient(): Clocked {
  if (!hasApiKey()) {
    throw new ConfigurationError('CLOCKED_API_KEY is not set, so live screening is unavailable.');
  }
  if (!client) {
    client = new Clocked({
      apiKey: process.env.CLOCKED_API_KEY,
      // The gateway allows the model 110s; a demo does not benefit from waiting
      // that long, and a fast, explicit failure is a better safety default.
      timeout: 30_000,
      maxAttempts: 2,
      retryBaseDelay: 400,
      retryMaxDelay: 3_000,
    });
  }
  return client;
}

export interface StageCall<T> {
  status: StageStatus;
  data: T | null;
  error: StageError | null;
  credits: number | null;
  attempts: number;
}

/** True when the "error" we got back is an HTML interstitial, not an API answer. */
function looksLikeHtml(raw: string): boolean {
  return /<\s*(!doctype|html|head|title|meta)/i.test(raw.slice(0, 400));
}

function tidy(raw: string): string {
  const stripped = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length === 0) return 'The API returned an empty error message.';
  return stripped.length > 240 ? `${stripped.slice(0, 237)}…` : stripped;
}

/**
 * A 403 served as an HTML page is almost never a rejected key — it is a bot or
 * network interstitial in front of the API. Reporting it as "your key is wrong"
 * would send an operator down the wrong path, so it gets its own code.
 */
function edgeInterstitial(status: number | null): StageError {
  return {
    code: 'edge_interstitial',
    message: `The request was answered with an HTML page instead of a JSON result (HTTP ${status ?? 'n/a'}). That is normally bot or network protection in front of the API rather than a credential problem, so retrying from the same network will not help. Verify the key from another network or from the provider's playground.`,
    retryable: false,
    httpStatus: status,
  };
}

export function classifyError(error: unknown): { status: StageStatus; error: StageError } {
  if (error instanceof RequestTimeoutError) {
    return {
      status: 'timeout',
      error: {
        code: 'timeout',
        message: 'Clocked did not answer within the per-attempt timeout. The outcome is unknown — retry the same request before starting a new one.',
        retryable: true,
        httpStatus: error.status,
      },
    };
  }
  if (error instanceof ConnectionError) {
    return {
      status: 'error',
      error: {
        code: 'connection',
        message: 'No response arrived from Clocked (DNS, TLS or an intermediary dropped the connection). The outcome is unknown, and nothing was screened.',
        retryable: true,
        httpStatus: error.status,
      },
    };
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    const raw = typeof error.error === 'string' ? error.error : '';
    if (looksLikeHtml(raw)) {
      return { status: 'error', error: edgeInterstitial(error.status) };
    }
    if (error instanceof AuthenticationError) {
      return {
        status: 'unauthorized',
        error: {
          code: 'unauthorized',
          message: 'Clocked rejected the API key. Check CLOCKED_API_KEY and whether the key was revoked.',
          retryable: false,
          httpStatus: error.status ?? 401,
        },
      };
    }
    return {
      status: 'unauthorized',
      error: {
        code: 'forbidden',
        message: 'The account is not permitted to use this endpoint. Check the plan and endpoint access.',
        retryable: false,
        httpStatus: error.status ?? 403,
      },
    };
  }
  if (error instanceof InsufficientCreditsError) {
    return {
      status: 'quota',
      error: {
        code: 'insufficient_credits',
        message: 'The Clocked account is out of credits for this request.',
        retryable: false,
        httpStatus: 402,
      },
    };
  }
  if (error instanceof RateLimitError) {
    return {
      status: 'quota',
      error: {
        code: 'concurrency_limit',
        message: 'The account hit its concurrency limit. Queue the work and retry with backoff.',
        retryable: true,
        httpStatus: 429,
      },
    };
  }
  if (error instanceof ValidationError) {
    return {
      status: 'invalid',
      error: {
        code: 'request_rejected',
        message: `Clocked rejected the request as invalid: ${error.error}`,
        retryable: false,
        httpStatus: error.status,
      },
    };
  }
  if (error instanceof ClockedError) {
    const raw = typeof error.error === 'string' ? error.error : '';
    if (looksLikeHtml(raw)) {
      return { status: 'error', error: edgeInterstitial(error.status) };
    }
    return {
      status: 'error',
      error: {
        code: 'clocked_error',
        message: raw ? tidy(raw) : 'Clocked returned an error.',
        retryable: error.status !== null && error.status >= 500,
        httpStatus: error.status,
      },
    };
  }
  if (error instanceof ConfigurationError) {
    return {
      status: 'error',
      error: { code: 'not_configured', message: error.message, retryable: false, httpStatus: null },
    };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      status: 'timeout',
      error: {
        code: 'aborted',
        message: 'The request was cancelled before Clocked answered.',
        retryable: true,
        httpStatus: null,
      },
    };
  }
  return {
    status: 'error',
    error: {
      code: 'unknown',
      message: error instanceof Error ? error.message : 'Unknown failure while calling Clocked.',
      retryable: false,
      httpStatus: null,
    },
  };
}

interface RawCall {
  data: unknown;
  credits: number | null;
  attempts: number;
}

function invalidShape(endpoint: string): StageCall<never> {
  return {
    status: 'invalid',
    data: null,
    credits: null,
    attempts: 1,
    error: {
      code: 'invalid_response',
      message: `${endpoint} returned a response without the fields TrustRoute needs. Treating the check as incomplete.`,
      retryable: false,
      httpStatus: 200,
    },
  };
}

async function run<T>(
  endpoint: string,
  call: () => Promise<RawCall>,
  normalise: (raw: unknown) => T | null,
): Promise<StageCall<T>> {
  try {
    const { data, credits, attempts } = await call();
    const parsed = normalise(data);
    if (parsed === null) {
      return { ...invalidShape(endpoint), attempts };
    }
    return { status: 'ok', data: parsed, error: null, credits, attempts };
  } catch (error) {
    const { status, error: stageError } = classifyError(error);
    return { status, data: null, error: stageError, credits: null, attempts: 1 };
  }
}

export async function liveGuard(
  text: string,
  instructions: string | null,
  signal: AbortSignal,
): Promise<StageCall<GuardData>> {
  return run(
    'POST /injection',
    async () => {
      const response = await getClient().injection(
        {
          text,
          source: 'content',
          ...(instructions ? { instructions } : {}),
          evidence: true,
          threshold: 0.5,
        },
        { signal },
      );
      return { data: response.data, credits: response.credits, attempts: response.attempts };
    },
    normalizeGuard,
  );
}

/** Entity kinds requested from Protect: all catalog kinds plus a custom secret kind. */
const PROTECT_ENTITIES = {
  person: null,
  email: null,
  phone: null,
  address: null,
  date_of_birth: null,
  ssn: null,
  credit_card: null,
  bank_account: null,
  ip_address: null,
  passport: null,
  drivers_license: null,
  medical: null,
  username: null,
  organization: null,
  location: null,
  employee_id: 'Internal employee or customer identifiers, such as EMP-90214 or CUS-77120',
  api_key: {
    description: 'API keys, access tokens and other credentials',
    format: 'sk_live_..., sk_test_..., ghp_..., AKIA..., xoxb-..., bearer tokens',
  },
} as const;

export async function liveProtect(text: string, signal: AbortSignal): Promise<StageCall<ProtectData>> {
  return run(
    'POST /pii',
    async () => {
      const response = await getClient().pii(
        {
          text,
          entities: PROTECT_ENTITIES as unknown as Record<string, string | null | { description: string; format?: string }>,
          anonymize: 'replace',
          threshold: 0.5,
        },
        { signal },
      );
      return { data: response.data, credits: response.credits, attempts: response.attempts };
    },
    normalizeProtect,
  );
}

export async function liveInspect(
  script: string,
  instructions: string | null,
  signal: AbortSignal,
): Promise<StageCall<InspectData>> {
  return run(
    'POST /script',
    async () => {
      const response = await getClient().script(
        {
          script,
          ...(instructions ? { instructions } : {}),
          evidence: true,
          threshold: 0.5,
        },
        { signal },
      );
      return { data: response.data, credits: response.credits, attempts: response.attempts };
    },
    normalizeInspect,
  );
}
