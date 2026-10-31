import { NextResponse } from 'next/server';

import { recordReview } from '@/lib/audit';
import { LIMITS } from '@/lib/config';
import { checkOrigin } from '@/lib/origin';
import { MIN_REJECT_NOTE, normalizeNote, noteSatisfiesAction } from '@/lib/review';
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
    return NextResponse.json({ error: 'invalid_json', message: 'Body must be valid JSON.' }, { status: 400 });
  }

  if (typeof body.runId !== 'string' || body.runId.length === 0 || body.runId.length > 80) {
    return NextResponse.json({ error: 'invalid_input', message: 'runId is required.' }, { status: 400 });
  }
  if (typeof body.action !== 'string' || !ACTIONS.includes(body.action as ReviewAction)) {
    return NextResponse.json(
      { error: 'invalid_input', message: `action must be one of ${ACTIONS.join(', ')}.` },
      { status: 400 },
    );
  }
  if (
    typeof body.decisionBefore !== 'string' ||
    !DECISIONS.includes(body.decisionBefore as Decision) ||
    typeof body.decisionAfter !== 'string' ||
    !DECISIONS.includes(body.decisionAfter as Decision)
  ) {
    return NextResponse.json(
      { error: 'invalid_input', message: 'decisionBefore and decisionAfter must be PASS, REVIEW or BLOCK.' },
      { status: 400 },
    );
  }

  // A reviewer note is optional to approve and required to reject. It is stored,
  // so it is length-capped: the note is a reason, not a place to paste the
  // sensitive content itself.
  const note = normalizeNote(body.note);
  if (!noteSatisfiesAction(body.action as ReviewAction, note)) {
    return NextResponse.json(
      {
        error: 'note_required',
        message: `A rejection must record a reason of at least ${MIN_REJECT_NOTE} characters.`,
      },
      { status: 400 },
    );
  }

  const event = recordReview({
    runId: body.runId,
    action: body.action as ReviewAction,
    note,
    decisionBefore: body.decisionBefore as Decision,
    decisionAfter: body.decisionAfter as Decision,
  });

  return NextResponse.json({ event }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
