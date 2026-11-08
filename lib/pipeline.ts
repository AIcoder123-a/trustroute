/**
 * The screening pipeline: one untrusted blob in, one decision out.
 *
 * Order matters. Detect → mask → decide. The decision engine never sees the raw
 * text, only the detection results and the redaction report, which keeps the
 * policy layer testable without any network or model in the loop.
 */

import { createHash, randomUUID } from 'node:crypto';

import { DEFAULT_INSTRUCTIONS } from './cases';
import { resolveRunMode, resolveThresholds } from './config';
import { runGuard, runInspect, runProtect, skippedStage } from './clocked';
import { buildRedaction } from './redact';
import { evaluatePolicy } from './policy';
import { pushAudit } from './audit';
import type { AnalyzeResponse, DetectionKind, GuardData, InspectData, ProtectData, StageStatus } from './types';
import type { ValidAnalyzeInput } from './validate';

export async function analyze(
  input: ValidAnalyzeInput,
  /**
   * The caller's audit bucket. Optional so unit tests can drive the pipeline
   * directly; the HTTP route always supplies one.
   */
  options: { sessionId?: string | null } = {},
): Promise<AnalyzeResponse> {
  const startedAt = performance.now();
  const mode = resolveRunMode();
  const instructions = input.instructions ?? DEFAULT_INSTRUCTIONS[input.contentType];
  const runId = `run_${randomUUID()}`;

  const inspectRequired = input.contentType === 'script';

  const [guard, protect, inspect] = await Promise.all([
    runGuard(input.text, input.contentType, instructions, mode),
    runProtect(input.text, mode),
    inspectRequired
      ? runInspect(input.text, instructions, mode)
      : Promise.resolve(
          skippedStage<InspectData>('inspect', mode, 'Not a script: Inspect was not requested for this content type.'),
        ),
  ]);

  const redaction = buildRedaction(
    input.text,
    protect.data?.entities ?? [],
    protect.data?.anonymizedText ?? null,
  );

  const policy = evaluatePolicy({
    contentType: input.contentType,
    guard,
    protect,
    inspect,
    redaction,
    thresholds: resolveThresholds(),
  });

  const warnings: string[] = [];
  if (mode === 'mock') {
    warnings.push(
      'Mock mode is active — no Clocked API was called. These results come from a local heuristic simulator and are NOT Clocked verdicts.',
    );
  }
  if (policy.degraded) {
    warnings.push('At least one detection did not complete. The decision was degraded to REVIEW by policy, not by a model.');
  }
  if (protect.status === 'ok' && protect.data && protect.data.entities.length > 0 && redaction.apiComparison === 'differs') {
    warnings.push(
      "TrustRoute's masked copy differs from Clocked's anonymized_text. The UI shows both; the copy built here is the one the gateway forwards when the decision allows forwarding.",
    );
  }

  const credits = [guard, protect, inspect].reduce((total, stage) => total + (stage.credits ?? 0), 0);

  const response: AnalyzeResponse = {
    runId,
    mode,
    createdAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    input: {
      contentType: input.contentType,
      characters: input.text.length,
      words: input.text.split(/\s+/).filter(Boolean).length,
      textHash: createHash('sha256').update(input.text, 'utf8').digest('hex').slice(0, 32),
      caseId: input.caseId,
      caseTitle: input.caseTitle,
      instructionsApplied: Boolean(instructions),
    },
    stages: { guard, protect, inspect },
    policy,
    redaction,
    warnings,
    credits: { total: credits, reported: credits > 0 },
  };

  const statuses = {
    guard: guard.status,
    protect: protect.status,
    inspect: inspect.status,
  } as Record<DetectionKind, StageStatus>;

  pushAudit({
    runId,
    createdAt: response.createdAt,
    mode,
    contentType: input.contentType,
    textHash: response.input.textHash,
    characters: response.input.characters,
    decision: policy.decision,
    // Recorded here, from the engine's own output, so the review route never
    // has to infer "was this fully screened" from a client's description.
    screening: policy.screening,
    sessionId: options.sessionId ?? null,
    stageStatuses: statuses,
    entityCount: protect.data?.entities.length ?? 0,
    guardInjection: (guard.data as GuardData | null)?.injection ?? null,
    inspectMalicious: (inspect.data as InspectData | null)?.malicious ?? null,
    durationMs: response.durationMs,
    review: null,
  });

  return response;
}

export type { ProtectData };
