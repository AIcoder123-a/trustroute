/**
 * Server-only configuration. Nothing here is importable from a client
 * component: `CLOCKED_API_KEY` must never reach the browser bundle, so this
 * module is guarded at runtime as well as by review.
 */

import type { ContentType, PolicyThresholds, RunMode } from './types';
import { DEFAULT_THRESHOLDS } from './policy';

if (typeof window !== 'undefined') {
  throw new Error('lib/config.ts is server-only and must not be imported from client code.');
}

const rateLimitOverride = Number(process.env.RATE_LIMIT_REQUESTS);

export const LIMITS = {
  /** Accepted prose length. Well under the 60,000-character Protect/Guard cap. */
  proseCharacters: 16_000,
  /** Accepted script length. Well under the 200,000-character Inspect cap. */
  scriptCharacters: 32_000,
  /** Deployment policy passed as `instructions`. */
  instructionsCharacters: 2_000,
  /** Absolute ceiling any single request may ever send to Clocked. */
  hardApiCap: 60_000,
  /** Client requests per window, per IP. Abuse control for the public demo. */
  requestsPerWindow:
    Number.isFinite(rateLimitOverride) && rateLimitOverride > 0 ? Math.trunc(rateLimitOverride) : 20,
  windowMs: 5 * 60 * 1000,
} as const;

export function maxCharactersFor(contentType: ContentType): number {
  return contentType === 'script' ? LIMITS.scriptCharacters : LIMITS.proseCharacters;
}

export function hasApiKey(): boolean {
  return typeof process.env.CLOCKED_API_KEY === 'string' && process.env.CLOCKED_API_KEY.trim().length > 0;
}

/**
 * `CLOCKED_MODE=auto` (default) uses the live API when a key is present and
 * falls back to the clearly-labelled mock. `live` without a key is an error,
 * never a silent downgrade — a deployment that believes it is live must not
 * quietly serve fixtures.
 */
export function resolveRunMode(): RunMode {
  const configured = (process.env.CLOCKED_MODE ?? 'auto').trim().toLowerCase();
  if (configured === 'mock') return 'mock';
  if (configured === 'live') {
    if (!hasApiKey()) {
      throw new ConfigurationError(
        'CLOCKED_MODE=live but CLOCKED_API_KEY is missing. Refusing to start in a mode that cannot screen content.',
      );
    }
    return 'live';
  }
  if (configured !== 'auto') {
    throw new ConfigurationError(`CLOCKED_MODE must be auto, live or mock (received "${configured}").`);
  }
  return hasApiKey() ? 'live' : 'mock';
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function resolveThresholds(): PolicyThresholds {
  return {
    blockInjectionProbability: envNumber(
      'POLICY_BLOCK_INJECTION',
      DEFAULT_THRESHOLDS.blockInjectionProbability,
      0.5,
      1,
    ),
    blockScriptMaliciousProbability: envNumber(
      'POLICY_BLOCK_SCRIPT',
      DEFAULT_THRESHOLDS.blockScriptMaliciousProbability,
      0.5,
      1,
    ),
    reviewInjectionProbability: DEFAULT_THRESHOLDS.reviewInjectionProbability,
    reviewScriptSuspiciousProbability: DEFAULT_THRESHOLDS.reviewScriptSuspiciousProbability,
    reviewEntityCount: envNumber('POLICY_REVIEW_ENTITY_COUNT', DEFAULT_THRESHOLDS.reviewEntityCount, 1, 32),
    highSensitivityKinds: DEFAULT_THRESHOLDS.highSensitivityKinds,
  };
}

/** Where the product states its data-handling boundary, in one place. */
export const DATA_BOUNDARY = {
  sentToClocked: [
    'the content you paste, or the demo case you load',
    'the deployment policy for the selected content type',
  ],
  staysLocal: [
    'the API key — read only by the server process, never placed in a payload',
    'browser history, cookies and account data',
  ],
  retained: [
    'an in-memory audit record holding a SHA-256 hash, character count and decision — no raw content',
    'review events recorded in this session (in memory, reset when the server restarts)',
  ],
} as const;
