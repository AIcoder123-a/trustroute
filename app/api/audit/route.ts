import { NextResponse } from 'next/server';

import { listAudit } from '@/lib/audit';
import { readSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recent screens from **this browser**, newest first.
 *
 * Every field is content-free by construction (`AuditRecord` has no text field):
 * a hash, a length, a decision, stage statuses. The one free-text field is the
 * reviewer note, and that is exactly why the list is scoped to the visitor's own
 * bucket — a note written on one machine is not served to another.
 *
 * The bucket id is a grouping key, not a credential, and is not returned.
 */
export async function GET() {
  // A visitor who has never screened anything has no bucket yet, and answering
  // with an empty list is both correct and cheaper than issuing one here.
  const sessionId = await readSession();
  // Rebuilt field by field rather than spread-and-subtract: the session bucket
  // is the server's bookkeeping, and a response object is the wrong place for
  // it to reappear by accident.
  const records = sessionId
    ? listAudit(10, sessionId).map((record) => ({
        runId: record.runId,
        createdAt: record.createdAt,
        mode: record.mode,
        contentType: record.contentType,
        textHash: record.textHash,
        characters: record.characters,
        decision: record.decision,
        screening: record.screening,
        stageStatuses: record.stageStatuses,
        entityCount: record.entityCount,
        guardInjection: record.guardInjection,
        inspectMalicious: record.inspectMalicious,
        durationMs: record.durationMs,
        review: record.review,
      }))
    : [];

  return NextResponse.json(
    { records, note: 'In-memory, content-free, scoped to this browser. Cleared when the server restarts.' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
