/**
 * TrustRoute — shared domain types.
 *
 * These types are the contract between the server-side inspection pipeline
 * (Clocked API adapters + policy engine) and the browser workbench.
 */

export const CONTENT_TYPES = ['support_ticket', 'web_content', 'tool_output', 'script'] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  support_ticket: 'Customer support ticket',
  web_content: 'Retrieved web content',
  tool_output: 'Agent tool output',
  script: 'Script / command',
};

/** Detection endpoints used by TrustRoute. */
export type DetectionKind = 'guard' | 'protect' | 'inspect';

/**
 * Per-stage outcome. `ok` is the only status that carries analysable data.
 * Every other status degrades the run and can never produce a PASS decision.
 */
export type StageStatus =
  | 'ok'
  | 'error'
  | 'timeout'
  | 'unauthorized'
  | 'quota'
  | 'invalid'
  | 'skipped';

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  ok: 'Completed',
  error: 'Request failed',
  timeout: 'Timed out',
  unauthorized: 'Authorization failed',
  quota: 'Credit / concurrency limit',
  invalid: 'Response failed validation',
  skipped: 'Not applicable',
};

export type Decision = 'PASS' | 'REVIEW' | 'BLOCK';

/** `live` = real Clocked API response. `mock` = local synthetic fixtures. */
export type RunMode = 'live' | 'mock';

export interface Span {
  start: number;
  end: number;
}

export interface GuardEvidence extends Span {
  quote: string;
  confidence: number;
}

export interface GuardData {
  model: string | null;
  /** Probability of prompt injection, 0–1. */
  injection: number;
  verdict: string;
  threshold: number;
  category: string | null;
  categories: Record<string, number>;
  severity: string | null;
  severities: Record<string, number>;
  severityExpected: number | null;
  evidence: GuardEvidence[];
  source: string | null;
  instructionsUsed: string | null;
}

export interface PiiEntity extends Span {
  type: string;
  value: string;
  confidence: number;
  source: string | null;
}

export interface ProtectData {
  model: string | null;
  entities: PiiEntity[];
  counts: Record<string, number>;
  /** Transform returned by Clocked when `anonymize` is requested. */
  anonymizedText: string | null;
  threshold: number | null;
  instructionsUsed: string | null;
}

export interface ScriptEvidence extends Span {
  line: string;
  confidence: number;
}

export interface InspectData {
  model: string | null;
  malicious: number | null;
  suspicious: number | null;
  verdict: string;
  threshold: number;
  category: string | null;
  categories: Record<string, number>;
  severity: string | null;
  severities: Record<string, number>;
  severityExpected: number | null;
  evidence: ScriptEvidence[];
  instructionsUsed: string | null;
}

export interface StageError {
  code: string;
  message: string;
  retryable: boolean;
  httpStatus: number | null;
}

export interface StageResult<T> {
  kind: DetectionKind;
  status: StageStatus;
  mode: RunMode;
  latencyMs: number;
  attempts: number;
  data: T | null;
  error: StageError | null;
  /** Credits debited for this request, when the API reports it. */
  credits: number | null;
  /** Endpoint path used, for auditability. */
  endpoint: string;
}

export type AnyStageResult = StageResult<GuardData> | StageResult<ProtectData> | StageResult<InspectData>;

/** A redaction span that TrustRoute actually applied to the forwarded copy. */
export interface AppliedRedaction extends Span {
  type: string;
  replacement: string;
  /** True when the API span did not match the text at its offsets. */
  realigned: boolean;
}

export interface RedactionReport {
  /** Masked copy that is safe to forward downstream. */
  maskedText: string | null;
  applied: AppliedRedaction[];
  /** Entities dropped because they overlapped an already-applied span. */
  dropped: { type: string; value: string; reason: string }[];
  /** Entities whose offsets were rejected as out of bounds / empty. */
  rejected: { type: string; value: string; reason: string }[];
  /** Comparison against Clocked's own `anonymized_text`, when returned. */
  apiComparison: 'match' | 'differs' | 'absent';
  totalEntities: number;
}

export interface PolicyReason {
  code: string;
  label: string;
  detail: string;
  severity: 'block' | 'review' | 'info';
  source: DetectionKind | 'pipeline' | 'policy';
}

export interface PolicyThresholds {
  blockInjectionProbability: number;
  blockScriptMaliciousProbability: number;
  reviewInjectionProbability: number;
  reviewScriptSuspiciousProbability: number;
  reviewEntityCount: number;
  highSensitivityKinds: string[];
}

export type PolicyCheckOutcome = 'pass' | 'review' | 'block' | 'skipped' | 'failed';

/**
 * One line of the policy engine's reasoning: what was measured, against which
 * line, and what that did to the decision. The decision itself is a pure
 * function of these checks, so showing them is showing the actual mechanism —
 * not a narrative written afterwards.
 */
export interface PolicyCheck {
  id: string;
  label: string;
  /** The measured value, already formatted for display. */
  observed: string;
  /** The line it was compared against. */
  threshold: string;
  outcome: PolicyCheckOutcome;
  source: DetectionKind | 'pipeline';
}

/**
 * Whether the run produced a usable risk verdict at all.
 *
 * `unavailable` is not a fourth decision: the decision stays REVIEW, because a
 * human must look. But the interface must not present it as a finding — no
 * detection completed, so nothing was actually assessed.
 */
export type ScreeningState = 'complete' | 'unavailable';

export interface PolicyOutcome {
  decision: Decision;
  /** One-line human-readable statement of what to do with the content. */
  headline: string;
  /** `unavailable` when a required detection did not complete. */
  screening: ScreeningState;
  reasons: PolicyReason[];
  actions: string[];
  /** Every threshold comparison, in evaluation order. */
  checks: PolicyCheck[];
  /** True when a human must decide before the content moves on. */
  requiresHumanReview: boolean;
  /** True when the masked copy may be forwarded instead of the original. */
  canForwardMasked: boolean;
  thresholds: PolicyThresholds;
  /** Set when a detection did not complete, so the run is untrustworthy. */
  degraded: boolean;
}

export interface AnalyzeInput {
  text: string;
  contentType: ContentType;
  /** Optional deployment policy passed to Guard / Inspect as `instructions`. */
  instructions: string | null;
  caseId: string | null;
  caseTitle: string | null;
}

export interface AnalyzeResponse {
  runId: string;
  mode: RunMode;
  createdAt: string;
  durationMs: number;
  input: {
    contentType: ContentType;
    characters: number;
    words: number;
    /** SHA-256 of the original text — a non-sensitive identifier for reports. */
    textHash: string;
    caseId: string | null;
    caseTitle: string | null;
    instructionsApplied: boolean;
  };
  stages: {
    guard: StageResult<GuardData>;
    protect: StageResult<ProtectData>;
    inspect: StageResult<InspectData>;
  };
  policy: PolicyOutcome;
  redaction: RedactionReport;
  /** Non-sensitive warnings the UI must show (e.g. mock mode, truncation). */
  warnings: string[];
  credits: { total: number; reported: boolean };
}

export type ReviewAction = 'approve' | 'reject' | 'recheck';

export interface ReviewEvent {
  id: string;
  runId: string;
  action: ReviewAction;
  note: string | null;
  decisionBefore: Decision;
  decisionAfter: Decision;
  at: string;
  actor: 'demo-reviewer';
}

export interface AuditRecord {
  runId: string;
  createdAt: string;
  mode: RunMode;
  contentType: ContentType;
  textHash: string;
  characters: number;
  decision: Decision;
  stageStatuses: Record<DetectionKind, StageStatus>;
  entityCount: number;
  guardInjection: number | null;
  inspectMalicious: number | null;
  durationMs: number;
  review: { action: ReviewAction; at: string; note: string | null } | null;
}

export type CaseExpectation = 'pass' | 'review' | 'block';

export interface DemoCase {
  id: string;
  title: string;
  /** Short scenario sentence shown in the rail. */
  summary: string;
  contentType: ContentType;
  expectation: CaseExpectation;
  /** Why this case exists — displayed under the input when loaded. */
  teaches: string;
  text: string;
  instructions: string | null;
}
