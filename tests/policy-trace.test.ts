/**
 * The rule trace is a claim about the engine: every decision can be explained by
 * the comparisons it lists, and each comparison reports the number it actually
 * used. These tests keep the trace honest — if a check is added without wiring,
 * or a threshold changes but the label does not, this fails.
 */

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
  return {
    kind: 'guard',
    status,
    mode: 'live',
    latencyMs: 10,
    attempts: 1,
    data:
      status === 'ok'
        ? {
            model: 'test',
            injection: 0.02,
            verdict: 'benign',
            threshold: 0.5,
            category: 'benign',
            categories: {},
            severity: 'none',
            severities: {},
            severityExpected: 0.2,
            evidence: [],
            source: 'content',
            instructionsUsed: 'custom',
            ...overrides,
          }
        : null,
    error: status === 'ok' ? null : { code: 'edge_interstitial', message: 'Blocked at the edge', retryable: false, httpStatus: 403 },
    credits: null,
    endpoint: 'POST /injection',
  };
}

function protectStage(entities: PiiEntity[] = []): StageResult<ProtectData> {
  return {
    kind: 'protect',
    status: 'ok',
    mode: 'live',
    latencyMs: 10,
    attempts: 1,
    data: { model: 'test', entities, counts: {}, anonymizedText: '', threshold: 0.5, instructionsUsed: 'custom' },
    error: null,
    credits: null,
    endpoint: 'POST /pii',
  };
}

function inspectStage(overrides: Partial<InspectData> = {}): StageResult<InspectData> {
  return {
    kind: 'inspect',
    status: 'ok',
    mode: 'live',
    latencyMs: 10,
    attempts: 1,
    data: {
      model: 'test',
      malicious: 0.01,
      suspicious: 0.02,
      verdict: 'benign',
      threshold: 0.5,
      category: null,
      categories: {},
      severity: 'none',
      severities: {},
      severityExpected: 0,
      evidence: [],
      instructionsUsed: 'custom',
      ...overrides,
    },
    error: null,
    credits: null,
    endpoint: 'POST /script',
  };
}

const redaction = (overrides: Partial<RedactionReport> = {}): RedactionReport => ({
  maskedText: null,
  applied: [],
  dropped: [],
  rejected: [],
  apiComparison: 'absent',
  totalEntities: 0,
  ...overrides,
});

function evaluate(input: {
  contentType?: ContentType;
  guard?: StageResult<GuardData>;
  protect?: StageResult<ProtectData>;
  inspect?: StageResult<InspectData>;
  redaction?: RedactionReport;
}) {
  return evaluatePolicy({
    contentType: input.contentType ?? 'support_ticket',
    guard: input.guard ?? guardStage(),
    protect: input.protect ?? protectStage(),
    inspect: input.inspect ?? inspectStage(),
    redaction: input.redaction ?? redaction(),
  });
}

describe('policy trace', () => {
  it('reports every threshold comparison with the observed value', () => {
    const outcome = evaluate({ guard: guardStage({ injection: 0.91, verdict: 'injection', severity: 'critical' }) });
    const blockCheck = outcome.checks.find((item) => item.id === 'guard_block_line');

    expect(blockCheck?.outcome).toBe('block');
    expect(blockCheck?.observed).toBe('91.0%');
    expect(blockCheck?.threshold).toContain(`${(DEFAULT_THRESHOLDS.blockInjectionProbability * 100).toFixed(1)}%`);
  });

  it('records the critical-severity override separately from the block line', () => {
    // 0.72 is under the 0.85 block line; it blocks only because the verdict is
    // injection with critical severity.
    const outcome = evaluate({ guard: guardStage({ injection: 0.72, verdict: 'injection', severity: 'critical' }) });

    expect(outcome.decision).toBe('BLOCK');
    expect(outcome.checks.find((item) => item.id === 'guard_block_line')?.outcome).toBe('pass');
    expect(outcome.checks.find((item) => item.id === 'guard_critical_override')?.outcome).toBe('block');
  });

  it('marks a failed stage as failed and keeps it out of the pass column', () => {
    const outcome = evaluate({ guard: guardStage({}, 'unauthorized') });
    const usable = outcome.checks.find((item) => item.id === 'guard_usable');

    expect(outcome.decision).toBe('REVIEW');
    expect(usable?.outcome).toBe('failed');
    expect(usable?.observed).toBe('unauthorized');
  });

  it('shows the review line as pass when the signal is quiet', () => {
    const outcome = evaluate({ guard: guardStage({ injection: 0.11, verdict: 'benign' }) });

    expect(outcome.checks.find((item) => item.id === 'guard_review_line')?.outcome).toBe('pass');
    expect(outcome.decision).toBe('PASS');
  });

  it('records a missing masked copy as a failure, not a silent skip', () => {
    const entity: PiiEntity = { type: 'person', value: 'A B', start: 0, end: 3, confidence: 1, source: 'model' };
    const outcome = evaluate({
      protect: protectStage([entity]),
      redaction: redaction({ maskedText: null, totalEntities: 1 }),
    });

    expect(outcome.checks.find((item) => item.id === 'protect_masked_copy')?.outcome).toBe('failed');
    expect(outcome.decision).toBe('REVIEW');
  });

  it('marks Inspect as skipped when the content is prose, not a script', () => {
    const outcome = evaluate({ contentType: 'web_content' });
    expect(outcome.checks.find((item) => item.id === 'inspect_usable')?.outcome).toBe('skipped');
  });

  it('never lists a block after a pass for the same comparison', () => {
    const outcome = evaluate({
      contentType: 'script',
      inspect: inspectStage({ malicious: 0.99, verdict: 'malicious', severity: 'critical' }),
    });
    const inspectChecks = outcome.checks.filter((item) => item.source === 'inspect');

    expect(outcome.decision).toBe('BLOCK');
    expect(inspectChecks.some((item) => item.outcome === 'block')).toBe(true);
    expect(inspectChecks.filter((item) => item.id === 'inspect_block_line')).toHaveLength(1);
  });
});
