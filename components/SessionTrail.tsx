'use client';

import type { AuditRecord } from '@/lib/types';
import { CONTENT_TYPE_LABELS } from '@/lib/types';
import { clockTime } from '@/lib/format';
import { DECISION_STYLE } from '@/components/ui';

const ACTION_LABEL: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  recheck: 'rechecked',
};

export function SessionTrail({ records }: { records: AuditRecord[] }) {
  return (
    <section className="panel overflow-hidden" aria-label="Session trail">
      <header className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <h2 className="text-[12.5px] font-semibold tracking-tight text-fg">Session trail</h2>
        <span className="mono text-[10px] text-fg-3">{records.length}</span>
      </header>

      {records.length === 0 ? (
        <p className="px-3 py-2.5 text-[11px] leading-relaxed text-fg-3">
          No screens yet. Each run writes a content-free record: hash, length, decision, stage statuses.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {records.map((record) => {
            const style = DECISION_STYLE[record.decision];
            return (
              <li key={record.runId} className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={`size-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                  <span className={`text-[11px] font-semibold ${style.text}`}>{record.decision}</span>
                  <span className="truncate text-[11px] text-fg-3">
                    {CONTENT_TYPE_LABELS[record.contentType]}
                  </span>
                  <span className="mono ml-auto shrink-0 text-[9.5px] text-fg-3">{clockTime(record.createdAt)}</span>
                </div>
                <div className="mono mt-1 flex items-center gap-1.5 text-[9.5px] text-fg-3">
                  <span>{record.textHash.slice(0, 10)}</span>
                  <span>·</span>
                  <span>{record.characters.toLocaleString()} ch</span>
                  {record.entityCount > 0 ? (
                    <>
                      <span>·</span>
                      <span>{record.entityCount} ent</span>
                    </>
                  ) : null}
                  {record.review ? (
                    <span className="ml-auto text-[9.5px] text-accent">{ACTION_LABEL[record.review.action]}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="border-t border-line px-3 py-2">
        <p className="text-[11px] leading-relaxed text-fg-3">
          In memory, no raw content. Restarting the server clears it.
        </p>
      </footer>
    </section>
  );
}
