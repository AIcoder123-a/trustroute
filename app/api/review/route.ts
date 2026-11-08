import { NextResponse } from 'next/server';

import { findAuditRecord, recordReview } from '@/lib/audit';
import { LIMITS } from '@/lib/config';
import { checkOrigin } from '@/lib/origin';
import { MIN_REJECT_NOTE, noteSatisfiesAction, normalizeNote, planReview } from '@/lib/review';
import { readSession } from '@/lib/session';
import type { Decision, ReviewAction } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS: ReviewAction[] = ['approve', 'reject', 'recheck'];
const DECISIONS: Decision[] = ['PASS', 'REVIEW', 'BLOCK'];

interface ReviewBody {
  runId?: unknown;
  action?: unknown;
  note?: unknown;
  decisionBefore?: unknown;
  decisionAfter?: unknown;
}

function invalid(message: string, code = 'invalid_input') {
  return NextResponse.json({ error: code, message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

function refused(code: string, message: string, status: number) {
  return NextResponse.json({ error: code, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const origin = checkOrigin(request);
  if (!origin.ok) {
    return NextResponse.json(
      { error: 'cross_origin_blocked', message: 'This endpoint only accepts requests from the application itself.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) {
    return NextResponse.json(
      { error: 'payload_too_large', message: 'Request body is larger than this demo accepts.' },
      { status: 413, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return invalid('Body must be valid JSON.', 'invalid_json');
  }

  if (typeof body.runId !== 'string' || body.runId.length === 0 || body.runId.length > 80) {
    return invalid('runId is required.');
  }
  if (typeof body.action !== 'string' || !ACTIONS.includes(body.action as ReviewAction)) {
    return invalid(`action must be one of ${ACTIONS.join(', ')}.`);
  }
  if (
    typeof body.decisionBefore !== 'string' ||
    !DECISIONS.includes(body.decisionBefore as Decision) ||
    typeof body.decisionAfter !== 'string' ||
    !DECISIONS.includes(body.decisionAfter as Decision)
  ) {
    return invalid('decisionBefore and decisionAfter must be PASS, REVIEW or BLOCK.');
  }

  /**
   * The authoritative facts come from the server's own record of the run, not
   * from the request. A client can claim any decisionBefore it likes; that
   * claim is worth nothing here, and the comparison below exists only to catch
   * a stale page, not to establish what the run was.
   */
  const sessionId = await readSession();
  const record = sessionId ? findAuditRecord(body.runId) : undefined;
  // A run from another browser is indistinguishable from one that never
  // existed: neither is this visitor's business.
  if (!sessionId || !record || record.sessionId !== sessionId) {
    return refused(
      'unknown_run',
      'This server has no record of that run for this browser. It may have been screened on another instance or before a restart — screen it again and review the new result.',
      404,
    );
  }

  if (body.decisionBefore !== record.decision) {
    return refused(
      'decision_before_mismatch',
      `This run was recorded as ${record.decision}; the request claims ${String(body.decisionBefore)}. Reload and review the recorded decision.`,
      409,
    );
  }

  const plan = planReview({
    action: body.action as ReviewAction,
    policyDecision: record.decision,
    screening: record.screening,
    requestedAfter: body.decisionAfter as Decision,
    alreadyReviewed: record.review !== null,
  });

  if (!plan.ok) {
    // 403 marks "this transition is not permitted", so a caller can tell a
    // refusal apart from a malformed request.
    return refused(plan.code, plan.message, 403);
  }

  // A reviewer note is optional to approve and required to reject. It is stored,
  // so it is length-capped: the note is a reason, not a place to paste the
  // sensitive content itself.
  const note = normalizeNote(body.note);
  if (!noteSatisfiesAction(body.action as ReviewAction, note)) {
    return invalid(`A rejection must record a reason of at least ${MIN_REJECT_NOTE} characters.`, 'note_required');
  }

  const event = recordReview({
    runId: record.runId,
    action: body.action as ReviewAction,
    note,
    decisionBefore: record.decision,
    decisionAfter: plan.decisionAfter,
  });

  return NextResponse.json({ event }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
