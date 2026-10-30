/**
 * Export report builder.
 *
 * Pure function, so it can be unit tested and so the same bytes can be asserted
 * in the test suite. Rules it enforces:
 *   - no API key, no raw original text, no entity values;
 *   - detection evidence that overlaps a personal-data span is withheld;
 *   - every field is labelled with where it came from (live Clocked API vs mock).
 */

import type { AnalyzeResponse, GuardData, InspectData, PiiEntity, ReviewEvent } from './types';

export interface ReviewReport {
  schema: 'trustroute.review-report/1';
  generatedAt: string;
  generator: { name: 'TrustRoute'; version: string; transport: 'live' | 'mock' };
  subject: {
    runId: string;
    contentType: string;
    characters: number;
    words: number;
    textHashSha256Prefix: string;
    caseId: string | null;
    caseTitle: string | null;
    screenedAt: string;
  };
  screening: {
    endpoint: string;
    status: string;
    verdict: string | null;
    probability: number | null;
    threshold: number | null;
    category: string | null;
    severity: string | null;
    evidence: { quote: string; note?: string }[];
    latencyMs: number;
    error: string | null;
  }[];
  decision: {
    decision: string;
    headline: string;
    degraded: boolean;
    thresholds: Record<string, unknown>;
    reasons: { code: string; label: string; detail: string; severity: string }[];
    actions: string[];
  };
  protection: {
    entitiesFound: number;
    kinds: string[];
    maskedCopyIncluded: boolean;
    maskedText: string | null;
    spansApplied: { type: string; start: number; end: number; realigned: boolean }[];
    spansDropped: number;
    spansRejected: number;
    comparisonWithClocked: string;
  };
  review: {
    action: string;
    at: string;
    decisionBefore: string;
    decisionAfter: string;
    note: string | null;
    actor: string;
  } | null;
  dataSources: string[];
  disclaimers: string[];
}

const PROBABILITY_DIGITS = 4;

function roundProbability(key: string, value: unknown): unknown {
  if (typeof value === 'number' && (key === 'probability' || key.endsWith('_probability'))) {
    return Number(value.toFixed(PROBABILITY_DIGITS));
  }
  return value;
}

function overlapsEntity(start: number, end: number, entities: PiiEntity[]): boolean {
  return entities.some((entity) => start < entity.end && end > entity.start);
}

function evidenceForGuard(data: GuardData | null, entities: PiiEntity[]): { quote: string; note?: string }[] {
  if (!data) return [];
  return data.evidence.map((item) =>
    overlapsEntity(item.start, item.end, entities)
      ? { quote: '[withheld: overlaps a personal-data finding]', note: 'quote withheld from the export' }
      : { quote: item.quote, note: `confidence ${item.confidence}` },
  );
}

function evidenceForInspect(data: InspectData | null, entities: PiiEntity[]): { quote: string; note?: string }[] {
  if (!data) return [];
  return data.evidence.map((item) =>
    overlapsEntity(item.start, item.end, entities)
      ? { quote: '[withheld: overlaps a personal-data finding]', note: 'quote withheld from the export' }
      : { quote: item.line, note: `confidence ${item.confidence}` },
  );
}

export function buildReport(result: AnalyzeResponse, review: ReviewEvent | null): ReviewReport {
  const entities = result.stages.protect.data?.entities ?? [];
  const guard = result.stages.guard.data;
  const inspect = result.stages.inspect.data;
  const protect = result.stages.protect.data;

  const screening: ReviewReport['screening'] = [
    {
      endpoint: result.stages.guard.endpoint,
      status: result.stages.guard.status,
      verdict: guard?.verdict ?? null,
      probability: guard?.injection ?? null,
      threshold: guard?.threshold ?? null,
      category: guard?.category ?? null,
      severity: guard?.severity ?? null,
      evidence: evidenceForGuard(guard, entities),
      latencyMs: result.stages.guard.latencyMs,
      error: result.stages.guard.error?.message ?? null,
    },
    {
      endpoint: result.stages.protect.endpoint,
      status: result.stages.protect.status,
      verdict: protect ? `${entities.length} finding(s)` : null,
      probability: null,
      threshold: protect?.threshold ?? null,
      category: null,
      severity: null,
      evidence: [],
      latencyMs: result.stages.protect.latencyMs,
      error: result.stages.protect.error?.message ?? null,
    },
    {
      endpoint: result.stages.inspect.endpoint,
      status: result.stages.inspect.status,
      verdict: inspect?.verdict ?? null,
      probability: inspect?.malicious ?? null,
      threshold: inspect?.threshold ?? null,
      category: inspect?.category ?? null,
      severity: inspect?.severity ?? null,
      evidence: evidenceForInspect(inspect, entities),
      latencyMs: result.stages.inspect.latencyMs,
      error: result.stages.inspect.error?.message ?? null,
    },
  ];

  const thresholds: Record<string, unknown> = {
    block_injection_probability: result.policy.thresholds.blockInjectionProbability,
    block_script_malicious_probability: result.policy.thresholds.blockScriptMaliciousProbability,
    review_injection_probability: result.policy.thresholds.reviewInjectionProbability,
    review_script_suspicious_probability: result.policy.thresholds.reviewScriptSuspiciousProbability,
    review_entity_count: result.policy.thresholds.reviewEntityCount,
    high_sensitivity_kinds: result.policy.thresholds.highSensitivityKinds,
  };

  return {
    schema: 'trustroute.review-report/1',
    generatedAt: new Date().toISOString(),
    generator: {
      name: 'TrustRoute',
      version: '0.1.0',
      transport: result.mode,
    },
    subject: {
      runId: result.runId,
      contentType: result.input.contentType,
      characters: result.input.characters,
      words: result.input.words,
      textHashSha256Prefix: result.input.textHash,
      caseId: result.input.caseId,
      caseTitle: result.input.caseTitle,
      screenedAt: result.createdAt,
    },
    screening,
    decision: {
      decision: result.policy.decision,
      headline: result.policy.headline,
      degraded: result.policy.degraded,
      thresholds,
      reasons: result.policy.reasons.map((reason) => ({
        code: reason.code,
        label: reason.label,
        detail: reason.detail,
        severity: reason.severity,
      })),
      actions: result.policy.actions,
    },
    protection: {
      entitiesFound: entities.length,
      kinds: Array.from(new Set(entities.map((entity) => entity.type))),
      maskedCopyIncluded: Boolean(result.redaction.maskedText),
      maskedText: result.redaction.maskedText,
      spansApplied: result.redaction.applied.map((span) => ({
        type: span.type,
        start: span.start,
        end: span.end,
        realigned: span.realigned,
      })),
      spansDropped: result.redaction.dropped.length,
      spansRejected: result.redaction.rejected.length,
      comparisonWithClocked: result.redaction.apiComparison,
    },
    review: review
      ? {
          action: review.action,
          at: review.at,
          decisionBefore: review.decisionBefore,
          decisionAfter: review.decisionAfter,
          note: review.note,
          actor: review.actor,
        }
      : null,
    dataSources:
      result.mode === 'live'
        ? [
            'Clocked Guard — POST https://clocked.rezolve.ai/clocked/injection',
            'Clocked Protect — POST https://clocked.rezolve.ai/clocked/pii',
            result.stages.inspect.status === 'skipped'
              ? 'Clocked Inspect — not requested for this content type'
              : 'Clocked Inspect — POST https://clocked.rezolve.ai/clocked/script',
            'TrustRoute policy engine — deterministic, server-side',
          ]
        : [
            'MOCK MODE — no Clocked API was called for this report',
            'Local heuristic simulator (TrustRoute) — not a Clocked verdict',
            'TrustRoute policy engine — deterministic, server-side',
          ],
    disclaimers: [
      'Detection probabilities are model estimates, not guarantees. A benign verdict is not proof of safety.',
      'Inspect performs static analysis only. Nothing was executed, and a passing verdict is not an execution authorization.',
      'Personal-data findings may be incomplete; masking applies to the findings returned, not to every possible sensitive fact.',
      result.mode === 'mock'
        ? 'This report was produced in mock mode and must not be presented as evidence of Clocked API behaviour.'
        : 'Probabilities and categories were returned by the Clocked API for this exact input.',
    ],
  };
}

/** Pretty JSON with probabilities rounded to four decimals for readability. */
export function reportToJson(report: ReviewReport): string {
  return JSON.stringify(report, roundProbability, 2);
}
