/**
 * In-memory audit trail.
 *
 * Deliberately ephemeral and deliberately content-free: a record holds a
 * SHA-256 of the submitted text, its length, the decision and the stage
 * outcomes — never the text itself, never an entity value, never the reply
 * body. Restarting the server clears it, which is the honest behaviour for a
 * demo deployment (see docs/SECURITY_NOTES.md).
 */

import type { AuditRecord, Decision, DetectionKind, ReviewAction, ReviewEvent, StageStatus } from './types';

const MAX_RECORDS = 200;
const audit: AuditRecord[] = [];
const reviews: ReviewEvent[] = [];

export function pushAudit(record: AuditRecord): void {
  audit.unshift(record);
  if (audit.length > MAX_RECORDS) audit.length = MAX_RECORDS;
}

export function recordReview(params: {
  runId: string;
  action: ReviewAction;
  note: string | null;
  decisionBefore: Decision;
  decisionAfter: Decision;
}): ReviewEvent {
  const event: ReviewEvent = {
    id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    runId: params.runId,
    action: params.action,
    note: params.note,
    decisionBefore: params.decisionBefore,
    decisionAfter: params.decisionAfter,
    at: new Date().toISOString(),
    actor: 'demo-reviewer',
  };
  reviews.unshift(event);
  if (reviews.length > MAX_RECORDS) reviews.length = MAX_RECORDS;

  const target = audit.find((item) => item.runId === params.runId);
  if (target) {
    target.review = { action: params.action, at: event.at, note: params.note };
  }
  return event;
}

/**
 * Recent screens, newest first.
 *
 * `sessionId` scopes the result to the caller's own bucket. The route always
 * passes one; omitting it is for tests that drive the pipeline directly.
 */
export function listAudit(limit = 20, sessionId?: string | null): AuditRecord[] {
  const scoped = sessionId === undefined ? audit : audit.filter((item) => item.sessionId === sessionId);
  return scoped.slice(0, limit);
}

/**
 * The authoritative record for one run.
 *
 * The review route reads the policy decision and the screening state from here
 * rather than from the request body: what a client claims about a run is not
 * evidence about that run.
 */
export function findAuditRecord(runId: string): AuditRecord | undefined {
  return audit.find((item) => item.runId === runId);
}

export function findReview(runId: string): ReviewEvent | undefined {
  return reviews.find((item) => item.runId === runId);
}

export function summariseStatuses(statuses: Record<DetectionKind, StageStatus>): string {
  return Object.entries(statuses)
    .map(([kind, status]) => `${kind}:${status}`)
    .join(' ');
}
