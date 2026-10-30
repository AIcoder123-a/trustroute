/**
 * TrustRoute policy engine.
 *
 * This file is deliberately boring: no model calls, no randomness, no I/O.
 * Given the three detection results it returns the same decision every time.
 * That is the point — the model output is *evidence*, the decision is *ours*.
 *
 * Safety invariant that the tests enforce: a detection that did not complete
 * can never produce PASS.
 */

import type {
  ContentType,
  Decision,
  GuardData,
  InspectData,
  PolicyOutcome,
  PolicyReason,
  PolicyThresholds,
  ProtectData,
  RedactionReport,
  StageResult,
} from './types';
import { HIGH_SENSITIVITY_KINDS, isHighSensitivity } from './redact';

export const DEFAULT_THRESHOLDS: PolicyThresholds = {
  /** At or above this probability Guard's judgment is treated as dispositive. */
  blockInjectionProbability: 0.85,
  /** At or above this probability Inspect's judgment is treated as dispositive. */
  blockScriptMaliciousProbability: 0.8,
  /** Between the endpoint's own threshold and the block line, a human decides. */
  reviewInjectionProbability: 0.5,
  reviewScriptSuspiciousProbability: 0.5,
  /** This many findings is enough to warrant a human even if all are low-risk. */
  reviewEntityCount: 6,
  highSensitivityKinds: [...HIGH_SENSITIVITY_KINDS],
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function pct(value: number): string {
  return `${(clamp01(value) * 100).toFixed(1)}%`;
}

export interface PolicyInput {
  contentType: ContentType;
  guard: StageResult<GuardData>;
  protect: StageResult<ProtectData>;
  inspect: StageResult<InspectData>;
  redaction: RedactionReport;
  thresholds?: Partial<PolicyThresholds>;
}

function stageFailureReason(label: string, stage: { status: string; error: { message: string } | null }): PolicyReason {
  const message = stage.error?.message ?? 'no result';
  return {
    code: 'detection_incomplete',
    label: `${label} did not complete`,
    detail: `${message}. TrustRoute does not release content that was not fully screened.`,
    severity: 'review',
    source: 'pipeline',
  };
}

export function evaluatePolicy(input: PolicyInput): PolicyOutcome {
  const thresholds: PolicyThresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const { guard, protect, inspect, redaction, contentType } = input;

  const reasons: PolicyReason[] = [];
  let block = false;
  let review = false;

  const inspectRequired = contentType === 'script';

  // ---- Pipeline integrity ------------------------------------------------
  // A missing or failed detection degrades the run. Never PASS.
  let degraded = false;
  if (guard.status !== 'ok' || !guard.data) {
    degraded = true;
    reasons.push(stageFailureReason('Guard (injection)', guard));
    review = true;
  }
  if (protect.status !== 'ok' || !protect.data) {
    degraded = true;
    reasons.push(stageFailureReason('Protect (PII)', protect));
    review = true;
  }
  if (inspectRequired && (inspect.status !== 'ok' || !inspect.data)) {
    degraded = true;
    reasons.push(stageFailureReason('Inspect (script)', inspect));
    review = true;
  }

  // ---- Guard -------------------------------------------------------------
  const guardData = guard.data;
  if (guard.status === 'ok' && guardData) {
    const probability = clamp01(guardData.injection);
    const severity = (guardData.severity ?? '').toLowerCase();
    const saysInjection = guardData.verdict === 'injection';

    if (probability >= thresholds.blockInjectionProbability || (saysInjection && severity === 'critical' && probability >= 0.7)) {
      block = true;
      reasons.push({
        code: 'prompt_injection',
        label: 'Prompt injection detected',
        detail: `Clocked Guard returned "${guardData.verdict}" at ${pct(probability)} injection probability${
          guardData.category ? ` (category: ${guardData.category})` : ''
        }${severity ? `, severity ${severity}` : ''}. The Gateway blocks content that is trying to redirect the agent.`,
        severity: 'block',
        source: 'guard',
      });
    } else if (saysInjection || probability >= thresholds.reviewInjectionProbability) {
      review = true;
      reasons.push({
        code: 'injection_uncertain',
        label: 'Injection signal needs a human',
        detail: `Clocked Guard returned "${guardData.verdict}" at ${pct(
          probability,
        )} injection probability — above the detection threshold but below the automatic block line of ${pct(
          thresholds.blockInjectionProbability,
        )}.`,
        severity: 'review',
        source: 'guard',
      });
    } else {
      reasons.push({
        code: 'injection_clear',
        label: 'No injection signal',
        detail: `Clocked Guard returned "${guardData.verdict}" at ${pct(probability)} injection probability.`,
        severity: 'info',
        source: 'guard',
      });
    }
  }

  // ---- Protect -----------------------------------------------------------
  const protectData = protect.data;
  if (protect.status === 'ok' && protectData) {
    const entities = protectData.entities ?? [];
    const highSensitivity = entities.filter((entity) => isHighSensitivity(entity.type));

    if (highSensitivity.length > 0) {
      review = true;
      const kinds = Array.from(new Set(highSensitivity.map((entity) => entity.type))).join(', ');
      reasons.push({
        code: 'high_sensitivity_pii',
        label: 'High-sensitivity personal data',
        detail: `Protect found ${highSensitivity.length} high-sensitivity ${
          highSensitivity.length === 1 ? 'finding' : 'findings'
        } (${kinds}). Masking removes the value, but a human must confirm the content is still needed downstream.`,
        severity: 'review',
        source: 'protect',
      });
    } else if (entities.length > 0) {
      reasons.push({
        code: 'low_sensitivity_pii',
        label: 'Personal data masked',
        detail: `Protect found ${entities.length} ${
          entities.length === 1 ? 'entity' : 'entities'
        } (${Array.from(new Set(entities.map((entity) => entity.type))).join(
          ', ',
        )}). None are high-sensitivity, so the masked copy can be forwarded without a human.`,
        severity: 'info',
        source: 'protect',
      });
    } else {
      reasons.push({
        code: 'no_pii',
        label: 'No personal data found',
        detail: 'Clocked Protect returned no entities for this content.',
        severity: 'info',
        source: 'protect',
      });
    }

    if (entities.length >= thresholds.reviewEntityCount) {
      review = true;
      reasons.push({
        code: 'high_entity_volume',
        label: 'Unusually high entity volume',
        detail: `${entities.length} personal-data findings exceeds the review line of ${thresholds.reviewEntityCount}. Volume alone is a signal that this content was not meant to be shared.`,
        severity: 'review',
        source: 'protect',
      });
    }

    if (entities.length > 0 && redaction.maskedText === null) {
      review = true;
      reasons.push({
        code: 'redaction_failed',
        label: 'Masked copy could not be produced',
        detail:
          'Protect returned spans but TrustRoute could not build a trustworthy masked copy from them. The original must not be forwarded in its place.',
        severity: 'review',
        source: 'protect',
      });
    } else if (redaction.dropped.length > 0 || redaction.rejected.length > 0) {
      reasons.push({
        code: 'redaction_adjusted',
        label: 'Overlapping findings reconciled',
        detail: `${redaction.dropped.length} overlapping and ${redaction.rejected.length} unusable span(s) were reconciled before masking. See the redaction detail below.`,
        severity: 'info',
        source: 'protect',
      });
    }
  }

  // ---- Inspect -----------------------------------------------------------
  const inspectData = inspect.data;
  if (inspectRequired && inspect.status === 'ok' && inspectData) {
    const malicious = clamp01(inspectData.malicious ?? 0);
    const suspicious = clamp01(inspectData.suspicious ?? 0);
    const severity = (inspectData.severity ?? '').toLowerCase();
    const saysMalicious = inspectData.verdict === 'malicious';

    if (malicious >= thresholds.blockScriptMaliciousProbability || (saysMalicious && severity === 'critical' && malicious >= 0.65)) {
      block = true;
      reasons.push({
        code: 'malicious_script',
        label: 'Malicious script behaviour',
        detail: `Clocked Inspect returned "${inspectData.verdict}" at ${pct(malicious)} malicious probability${
          inspectData.category ? ` (category: ${inspectData.category})` : ''
        }. The Gateway blocks this script from any agent tool call.`,
        severity: 'block',
        source: 'inspect',
      });
    } else if (saysMalicious || inspectData.verdict === 'suspicious' || suspicious >= thresholds.reviewScriptSuspiciousProbability) {
      review = true;
      reasons.push({
        code: 'script_needs_review',
        label: 'Script flagged for human review',
        detail: `Clocked Inspect returned "${inspectData.verdict}" (malicious ${pct(malicious)}, suspicious ${pct(
          suspicious,
        )})${inspectData.category ? ` with category "${inspectData.category}"` : ''}. Static analysis cannot confirm intent — a human approves or rejects.`,
        severity: 'review',
        source: 'inspect',
      });
    } else {
      reasons.push({
        code: 'script_benign',
        label: 'No malicious behaviour detected',
        detail: `Clocked Inspect returned "${inspectData.verdict}" at ${pct(
          malicious,
        )} malicious probability. This is a static assessment, not an execution authorization.`,
        severity: 'info',
        source: 'inspect',
      });
    }
  } else if (!inspectRequired) {
    reasons.push({
      code: 'inspect_not_applicable',
      label: 'Inspect not applicable',
      detail: 'This content type is prose, so no script analysis was requested.',
      severity: 'info',
      source: 'inspect',
    });
  }

  // ---- Decision ----------------------------------------------------------
  let decision: Decision = 'PASS';
  if (block) decision = 'BLOCK';
  else if (review) decision = 'REVIEW';

  const actions: string[] = [];
  let headline: string;

  if (decision === 'BLOCK') {
    headline = 'Do not forward this content. Blocked at the gateway.';
    actions.push('Quarantine the message and stop the agent run.');
    actions.push('Notify the content owner out of band — never through this channel.');
    actions.push('Keep the hashed audit record; the original stays unscreened-for-forwarding.');
  } else if (decision === 'REVIEW') {
    headline = degraded
      ? 'Screening incomplete. Hold the content and route it to a human.'
      : 'Hold at the human checkpoint before the agent reads it.';
    actions.push('Route to a reviewer with the evidence below.');
    if (redaction.maskedText) actions.push('Forward only the masked copy, and only after approval.');
    else actions.push('Forward nothing until a reviewer has read the content.');
    if (degraded) actions.push('Re-run the failed detection before making any decision.');
  } else {
    headline = redaction.maskedText && (protectData?.entities.length ?? 0) > 0
      ? 'Safe to forward — as the masked copy.'
      : 'Safe to forward.';
    if (protectData?.entities.length) actions.push('Forward the masked copy; the original never leaves the gateway.');
    else actions.push('Forward to the agent unchanged.');
    actions.push('Continue the run without human review.');
  }

  return {
    decision,
    headline,
    reasons,
    actions,
    requiresHumanReview: decision !== 'PASS',
    canForwardMasked: Boolean(redaction.maskedText) && decision !== 'BLOCK',
    thresholds,
    degraded,
  };
}
