import { describe, expect, it } from 'vitest';

import { DEFAULT_THRESHOLDS, evaluatePolicy } from '@/lib/policy';
import type {
  ContentType,
  GuardData,
  InspectData,
  PiiEntity,
  ProtectData,
  RedactionReport,
  StageResult,
  StageStatus,
} from '@/lib/types';

function guardStage(overrides: Partial<GuardData> = {}, status: StageStatus = 'ok'): StageResult<GuardData> {
  const data: GuardData = {
    model: 'test',
    injection: 0.02,
    verdict: 'benign',
    threshold: 0.5,
    category: 'benign',
    categories: { benign: 0.98 },
    severity: 'none',
    severities: { none: 0.98 },
    severityExpected: 0.3,
    evidence: [],
    source: 'content',
    instructionsUsed: 'custom',
    ...overrides,
  };
  return {
    kind: 'guard',
    status,
    mode: 'mock',
    latencyMs: 10,
    attempts: 1,
    data: status === 'ok' ? data : null,
    error: status === 'ok' ? null : { code: 'boom', message: 'Guard failed', retryable: true, httpStatus: 500 },
    credits: null,
    endpoint: 'POST /injection',
  };
}

function protectStage(entities: PiiEntity[] = [], status: StageStatus = 'ok'): StageResult<ProtectData> {
  const counts: Record<string, number> = {};
  for (const entity of entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  return {
    kind: 'protect',
    status,
    mode: 'mock',
    latencyMs: 10,
    attempts: 1,
    data:
      status === 'ok'
        ? { model: 'test', entities, counts, anonymizedText: '', threshold: 0.5, instructionsUsed: 'default' }
        : null,
    error: status === 'ok' ? null : { code: 'boom', message: 'Protect failed', retryable: true, httpStatus: 500 },
    credits: null,
    endpoint: 'POST /pii',
  };
}

function inspectStage(overrides: Partial<InspectData> = {}, status: StageStatus = 'ok'): StageResult<InspectData> {
  const data: InspectData = {
    model: 'test',
    malicious: 0.04,
    suspicious: 0.08,
    verdict: 'benign',
    threshold: 0.5,
    category: 'benign administration',
    categories: {},
    severity: 'none',
    severities: {},
    severityExpected: 0.2,
    evidence: [],
    instructionsUsed: 'custom',
    ...overrides,
  };
  return {
    kind: 'inspect',
    status,
    mode: 'mock',
    latencyMs: 10,
    attempts: 1,
    data: status === 'ok' ? data : null,
    error: status === 'ok' ? null : { code: 'boom', message: 'Inspect failed', retryable: true, httpStatus: 500 },
    credits: null,
    endpoint: 'POST /script',
  };
}

const CLEAN_REDACTION: RedactionReport = {
  maskedText: 'clean text',
  applied: [],
  dropped: [],
  rejected: [],
  apiComparison: 'absent',
  totalEntities: 0,
};

const pii: PiiEntity = { type: 'email', value: 'a@example.com', start: 0, end: 13, confidence: 1, source: 'model' };
const ssn: PiiEntity = { type: 'ssn', value: '078-05-1120', start: 0, end: 11, confidence: 1, source: 'model' };

function evaluate(input: {
  contentType?: ContentType;
  guard?: StageResult<GuardData>;
  protect?: StageResult<ProtectData>;
  inspect?: StageResult<InspectData>;
  redaction?: RedactionReport;
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
}) {
  return evaluatePolicy({
    contentType: input.contentType ?? 'support_ticket',
    guard: input.guard ?? guardStage(),
    protect: input.protect ?? protectStage(),
    inspect: input.inspect ?? inspectStage(),
    redaction: input.redaction ?? CLEAN_REDACTION,
    thresholds: input.thresholds,
  });
}

describe('policy engine', () => {
  it('passes clean content', () => {
    const outcome = evaluate({});
    expect(outcome.decision).toBe('PASS');
    expect(outcome.degraded).toBe(false);
    expect(outcome.requiresHumanReview).toBe(false);
  });

  it('never passes when Guard failed', () => {
    const outcome = evaluate({ guard: guardStage({}, 'error') });
    expect(outcome.decision).toBe('REVIEW');
    expect(outcome.degraded).toBe(true);
    expect(outcome.reasons.some((reason) => reason.code === 'detection_incomplete')).toBe(true);
  });

  it('never passes when Protect failed', () => {
    const outcome = evaluate({ protect: protectStage([], 'unauthorized') });
    expect(outcome.decision).toBe('REVIEW');
    expect(outcome.degraded).toBe(true);
  });

  it('never passes when Inspect was required but did not run', () => {
    const outcome = evaluate({ contentType: 'script', inspect: inspectStage({}, 'skipped') });
    expect(outcome.decision).toBe('REVIEW');
    expect(outcome.degraded).toBe(true);
  });

  it('never passes on a timeout', () => {
    const outcome = evaluate({ guard: guardStage({}, 'timeout'), protect: protectStage([], 'quota') });
    expect(outcome.decision).toBe('REVIEW');
  });

  it('blocks a clear injection', () => {
    const outcome = evaluate({
      guard: guardStage({ injection: 0.94, verdict: 'injection', severity: 'critical' }),
    });
    expect(outcome.decision).toBe('BLOCK');
    expect(outcome.canForwardMasked).toBe(false);
  });

  it('reviews an uncertain injection instead of clearing it', () => {
    const outcome = evaluate({
      guard: guardStage({ injection: 0.62, verdict: 'injection', severity: 'medium' }),
    });
    expect(outcome.decision).toBe('REVIEW');
  });

  it('reviews content with high-sensitivity personal data', () => {
    const outcome = evaluate({
      protect: protectStage([ssn]),
      redaction: { ...CLEAN_REDACTION, maskedText: '<SSN>', totalEntities: 1 },
    });
    expect(outcome.decision).toBe('REVIEW');
    expect(outcome.reasons.some((reason) => reason.code === 'high_sensitivity_pii')).toBe(true);
  });

  it('passes content where only low-sensitivity data was masked', () => {
    const outcome = evaluate({
      protect: protectStage([pii]),
      redaction: { ...CLEAN_REDACTION, maskedText: '<EMAIL>', totalEntities: 1 },
    });
    expect(outcome.decision).toBe('PASS');
    expect(outcome.canForwardMasked).toBe(true);
    expect(outcome.actions.join(' ')).toMatch(/masked copy/i);
  });

  it('reviews when personal data was found but no masked copy could be built', () => {
    const outcome = evaluate({
      protect: protectStage([pii]),
      redaction: { ...CLEAN_REDACTION, maskedText: null, totalEntities: 1 },
    });
    expect(outcome.decision).toBe('REVIEW');
    expect(outcome.canForwardMasked).toBe(false);
    expect(outcome.reasons.some((reason) => reason.code === 'redaction_failed')).toBe(true);
  });

  it('blocks a malicious script', () => {
    const outcome = evaluate({
      contentType: 'script',
      inspect: inspectStage({ malicious: 0.93, suspicious: 0.97, verdict: 'malicious', severity: 'critical' }),
    });
    expect(outcome.decision).toBe('BLOCK');
  });

  it('reviews a suspicious script', () => {
    const outcome = evaluate({
      contentType: 'script',
      inspect: inspectStage({ malicious: 0.45, suspicious: 0.6, verdict: 'suspicious', severity: 'medium' }),
    });
    expect(outcome.decision).toBe('REVIEW');
  });

  it('lets BLOCK win over REVIEW', () => {
    const outcome = evaluate({
      guard: guardStage({ injection: 0.97, verdict: 'injection', severity: 'critical' }),
      protect: protectStage([ssn]),
    });
    expect(outcome.decision).toBe('BLOCK');
    expect(outcome.requiresHumanReview).toBe(true);
  });

  it('honours an overridden block threshold', () => {
    const strict = evaluate({
      guard: guardStage({ injection: 0.7, verdict: 'injection', severity: 'high' }),
      thresholds: { blockInjectionProbability: 0.65 },
    });
    expect(strict.decision).toBe('BLOCK');

    const lenient = evaluate({
      guard: guardStage({ injection: 0.7, verdict: 'injection', severity: 'high' }),
      thresholds: { blockInjectionProbability: 0.95 },
    });
    expect(lenient.decision).toBe('REVIEW');
  });
});

describe('screening state', () => {
  const UNAVAILABLE = 'Screening unavailable — manual review required.';

  it('reports an incomplete run as unavailable, not as a risk finding', () => {
    const outcome = evaluate({ guard: guardStage({}, 'timeout') });
    expect(outcome.decision).toBe('REVIEW');
    expect(outcome.screening).toBe('unavailable');
    expect(outcome.headline).toBe(UNAVAILABLE);
    // "Hold for review" would read as if a detector had found something.
    expect(outcome.headline).not.toMatch(/hold at the human checkpoint/i);
  });

  it('never calls a complete run unavailable', () => {
    const outcome = evaluate({});
    expect(outcome.screening).toBe('complete');
    expect(outcome.headline).toBe('Safe to forward.');
  });

  it('keeps a real block as a verdict even when another stage failed', () => {
    const outcome = evaluate({
      protect: protectStage([], 'error'),
      guard: guardStage({ injection: 0.94, verdict: 'injection', severity: 'critical' }),
    });
    expect(outcome.decision).toBe('BLOCK');
    expect(outcome.screening).toBe('complete');
    expect(outcome.headline).toMatch(/Do not forward/);
  });

  it('records completeness in the trace so the reason is visible', () => {
    const outcome = evaluate({ protect: protectStage([], 'quota') });
    const completeness = outcome.checks.find((item) => item.id === 'screening_complete');
    expect(completeness?.outcome).toBe('failed');
  });

  it('tells the reviewer not to read the run as a verdict', () => {
    const outcome = evaluate({ protect: protectStage([], 'quota') });
    expect(outcome.actions.join(' ')).toMatch(/not treat this run as a risk verdict/i);
  });
});
