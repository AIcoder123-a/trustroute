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
  PolicyCheck,
  PolicyCheckOutcome,
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
  const raw = stage.error?.message ?? 'no result';
  const message = raw.replace(/\s*\.\s*$/, '');
  return {
    code: 'detection_incomplete',
    label: `${label} did not complete`,
    detail: `${message}. TrustRoute does not release content that was not fully screened.`,
    severity: 'review',
    source: 'pipeline',
  };
}

function check(
  id: string,
  label: string,
  observed: string,
  threshold: string,
  outcome: PolicyCheckOutcome,
  source: PolicyCheck['source'],
): PolicyCheck {
  return { id, label, observed, threshold, outcome, source };
}

export function evaluatePolicy(input: PolicyInput): PolicyOutcome {
  const thresholds: PolicyThresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const { guard, protect, inspect, redaction, contentType } = input;

  // Which detector produced these numbers. In mock mode no request was made, so
  // writing "Clocked Guard returned" into a reason would misreport the run.
  const live = guard.mode === 'live';
  const guardName = live ? 'Clocked Guard' : 'The local Guard simulator';
  const protectName = live ? 'Clocked Protect' : 'The local Protect simulator';
  const inspectName = live ? 'Clocked Inspect' : 'The local Inspect simulator';

  const reasons: PolicyReason[] = [];
  const checks: PolicyCheck[] = [];
  let block = false;
  let review = false;

  const inspectRequired = contentType === 'script';

  // ---- Pipeline integrity ------------------------------------------------
  // A missing or failed detection degrades the run. Never PASS.
  let degraded = false;
  if (guard.status !== 'ok' || !guard.data) {
    degraded = true;
    reasons.push(stageFailureReason('Guard (injection)', guard));
    checks.push(check('guard_usable', 'Guard returned a usable result', guard.status, 'required', 'failed', 'pipeline'));
    review = true;
  } else {
    checks.push(check('guard_usable', 'Guard returned a usable result', 'ok', 'required', 'pass', 'pipeline'));
  }
  if (protect.status !== 'ok' || !protect.data) {
    degraded = true;
    reasons.push(stageFailureReason('Protect (PII)', protect));
    checks.push(check('protect_usable', 'Protect returned a usable result', protect.status, 'required', 'failed', 'pipeline'));
    review = true;
  } else {
    checks.push(check('protect_usable', 'Protect returned a usable result', 'ok', 'required', 'pass', 'pipeline'));
  }
  if (inspectRequired && (inspect.status !== 'ok' || !inspect.data)) {
    degraded = true;
    reasons.push(stageFailureReason('Inspect (script)', inspect));
    checks.push(check('inspect_usable', 'Inspect returned a usable result', inspect.status, 'required', 'failed', 'pipeline'));
    review = true;
  } else if (inspectRequired) {
    checks.push(check('inspect_usable', 'Inspect returned a usable result', 'ok', 'required', 'pass', 'pipeline'));
  } else {
    checks.push(
      check('inspect_usable', 'Inspect requirement for this content type', 'not needed for prose', 'scripts only', 'skipped', 'pipeline'),
    );
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
        detail: `${guardName} returned "${guardData.verdict}" at ${pct(probability)} injection probability${
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
        detail: `${guardName} returned "${guardData.verdict}" at ${pct(
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
        detail: `${guardName} returned "${guardData.verdict}" at ${pct(probability)} injection probability.`,
        severity: 'info',
        source: 'guard',
      });
    }

    // The trace records the comparison, not the conclusion: a reader can see the
    // measured number next to the line it was compared against. `block` is not
    // used here on purpose — the override below can block without this line
    // being crossed, and the trace must not pretend otherwise.
    const aboveBlockLine = probability >= thresholds.blockInjectionProbability;
    checks.push(
      check(
        'guard_block_line',
        'Injection probability vs block line',
        pct(probability),
        `≥ ${pct(thresholds.blockInjectionProbability)}`,
        aboveBlockLine ? 'block' : 'pass',
        'guard',
      ),
    );
    if (saysInjection && severity === 'critical' && probability >= 0.7) {
      checks.push(
        check(
          'guard_critical_override',
          'Critical-severity injection verdict',
          `${guardData.verdict} · ${severity} · ${pct(probability)}`,
          'injection + critical at ≥ 70.0%',
          'block',
          'guard',
        ),
      );
    }
    if (!block) {
      const needsHuman = saysInjection || probability >= thresholds.reviewInjectionProbability;
      checks.push(
        check(
          'guard_review_line',
          'Injection probability vs review line',
          pct(probability),
          `≥ ${pct(thresholds.reviewInjectionProbability)} or verdict "injection"`,
          needsHuman ? 'review' : 'pass',
          'guard',
        ),
      );
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
        detail: `${protectName} returned no entities for this content.`,
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

    checks.push(
      check(
        'protect_high_sensitivity',
        'High-sensitivity findings',
        highSensitivity.length === 0 ? 'none' : `${highSensitivity.length} (${Array.from(new Set(highSensitivity.map((entity) => entity.type))).join(', ')})`,
        '0 tolerated without a human',
        highSensitivity.length > 0 ? 'review' : 'pass',
        'protect',
      ),
      check(
        'protect_volume',
        'Total personal-data findings',
        String(entities.length),
        `< ${thresholds.reviewEntityCount}`,
        entities.length >= thresholds.reviewEntityCount ? 'review' : 'pass',
        'protect',
      ),
      check(
        'protect_masked_copy',
        'Masked copy for forwarding',
        redaction.maskedText ? 'built' : entities.length > 0 ? 'not built' : 'not needed',
        'required once a finding exists',
        entities.length > 0 && redaction.maskedText === null ? 'failed' : entities.length === 0 ? 'skipped' : 'pass',
        'protect',
      ),
    );
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
        detail: `${inspectName} returned "${inspectData.verdict}" at ${pct(malicious)} malicious probability${
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
        detail: `${inspectName} returned "${inspectData.verdict}" (malicious ${pct(malicious)}, suspicious ${pct(
          suspicious,
        )})${inspectData.category ? ` with category "${inspectData.category}"` : ''}. Static analysis cannot confirm intent — a human approves or rejects.`,
        severity: 'review',
        source: 'inspect',
      });
    } else {
      reasons.push({
        code: 'script_benign',
        label: 'No malicious behaviour detected',
        detail: `${inspectName} returned "${inspectData.verdict}" at ${pct(
          malicious,
        )} malicious probability. This is a static assessment, not an execution authorization.`,
        severity: 'info',
        source: 'inspect',
      });
    }

    const aboveBlockLine = malicious >= thresholds.blockScriptMaliciousProbability;
    const criticalOverride = saysMalicious && severity === 'critical' && malicious >= 0.65;
    checks.push(
      check(
        'inspect_block_line',
        'Malicious probability vs block line',
        pct(malicious),
        `≥ ${pct(thresholds.blockScriptMaliciousProbability)}`,
        aboveBlockLine ? 'block' : 'pass',
        'inspect',
      ),
    );
    if (criticalOverride) {
      checks.push(
        check(
          'inspect_critical_override',
          'Critical-severity malicious verdict',
          `${inspectData.verdict} · ${severity} · ${pct(malicious)}`,
          'malicious + critical at ≥ 65.0%',
          'block',
          'inspect',
        ),
      );
    }
    if (!aboveBlockLine) {
      const needsHuman = saysMalicious || inspectData.verdict === 'suspicious' || suspicious >= thresholds.reviewScriptSuspiciousProbability;
      checks.push(
        check(
          'inspect_review_line',
          'Script signal vs review line',
          `${pct(suspicious)} suspicious · verdict ${inspectData.verdict}`,
          `≥ ${pct(thresholds.reviewScriptSuspiciousProbability)} or verdict suspicious/malicious`,
          needsHuman ? 'review' : 'pass',
          'inspect',
        ),
      );
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

  // A partial run is not a finding. Saying "hold for review" is true but not
  // enough: a reader can hear "review" as "something was detected". This flag
  // drives an explicit unavailable state in the interface and the export.
  //
  // A block still counts as a verdict even when another stage failed: Guard
  // saying "injection" is a finding, not an absence of one.
  const screening = degraded && !block ? 'unavailable' : 'complete';

  checks.push(
    check(
      'screening_complete',
      'Required detections completed',
      degraded ? 'at least one did not complete' : inspectRequired ? '3 of 3' : '2 of 2',
      'all required',
      degraded ? 'failed' : 'pass',
      'pipeline',
    ),
  );

  const actions: string[] = [];
  let headline: string;

  if (decision === 'BLOCK') {
    headline = 'Do not forward this content. Blocked at the gateway.';
    actions.push('Quarantine the message and stop the agent run.');
    actions.push('Notify the content owner out of band — never through this channel.');
    actions.push('Keep the hashed audit record; the original stays unscreened-for-forwarding.');
  } else if (degraded) {
    headline = 'Screening unavailable — manual review required.';
    actions.push('Do not treat this run as a risk verdict: at least one required detection returned no result.');
    actions.push('Re-run the failed detection, or screen the content somewhere that can reach the API.');
    actions.push('Until then, a reviewer must read the content itself before anything is released.');
  } else if (decision === 'REVIEW') {
    headline = 'Hold at the human checkpoint before the agent reads it.';
    actions.push('Route to a reviewer with the evidence below.');
    if (redaction.maskedText) actions.push('Forward only the masked copy, and only after approval.');
    else actions.push('Forward nothing until a reviewer has read the content.');
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
    screening,
    reasons,
    actions,
    checks,
    requiresHumanReview: decision !== 'PASS',
    canForwardMasked: Boolean(redaction.maskedText) && decision !== 'BLOCK',
    thresholds,
    degraded,
  };
}
