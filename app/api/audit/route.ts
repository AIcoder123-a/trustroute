import { NextResponse } from 'next/server';

import { listAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recent screens, newest first. Every field is content-free by construction
 * (`AuditRecord` has no text field) — a hash, a length, a decision, stage
 * statuses. Nothing here can leak what was screened.
 */
export async function GET() {
  return NextResponse.json(
    { records: listAudit(10), note: 'In-memory, content-free. Cleared when the server restarts.' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
