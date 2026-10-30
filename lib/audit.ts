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

export function listAudit(limit = 20): AuditRecord[] {
  return audit.slice(0, limit);
}

export function findReview(runId: string): ReviewEvent | undefined {
  return reviews.find((item) => item.runId === runId);
}

export function summariseStatuses(statuses: Record<DetectionKind, StageStatus>): string {
  return Object.entries(statuses)
    .map(([kind, status]) => `${kind}:${status}`)
    .join(' ');
}
