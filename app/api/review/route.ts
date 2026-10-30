import { NextResponse } from 'next/server';

import { recordReview } from '@/lib/audit';
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

  // A reviewer note is optional and must stay short: it is stored, and could
  // otherwise become a place for someone to paste the sensitive content itself.
  const note =
    typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim().slice(0, 280) : null;

  const event = recordReview({
    runId: body.runId,
    action: body.action as ReviewAction,
    note,
    decisionBefore: body.decisionBefore as Decision,
    decisionAfter: body.decisionAfter as Decision,
  });

  return NextResponse.json({ event }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
