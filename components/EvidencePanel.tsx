'use client';

import type { AnalyzeResponse } from '@/lib/types';
import { buildEvidenceRows, type EvidenceRow } from '@/lib/evidence';
import { pct } from '@/lib/format';
import { ChevronRightIcon } from '@/components/icons';

/**
 * The passage-level evidence behind Guard and Inspect, in one list.
 *
 * Each row is a real span in the text the reviewer pasted — not a summary — and
 * clicking it locates that span in the reader above. Rows whose offsets do not
 * fit the text are still shown, marked as unplaced: hiding them would look like
 * the detector found nothing there.
 */
export function EvidencePanel({
  result,
  text,
  focusId,
  onLocate,
}: {
  result: AnalyzeResponse;
  text: string;
  focusId: string | null;
  onLocate: (row: EvidenceRow) => void;
}) {
  const rows = buildEvidenceRows(text, {
    guard: result.stages.guard.data,
    inspect: result.stages.inspect.data,
  });
  const entityCount = result.stages.protect.data?.entities.length ?? 0;
  // Protect is included: a failed Protect leaves the same hole in the evidence
  // as a failed Guard, and calling that "no passage returned" would be too mild.
  const failedDetectors = [
    result.stages.guard.status !== 'ok' ? 'Guard' : null,
    result.stages.protect.status !== 'ok' ? 'Protect' : null,
    result.stages.inspect.status !== 'ok' && result.stages.inspect.status !== 'skipped' ? 'Inspect' : null,
  ].filter((name): name is string => name !== null);

  return (
    <section id="evidence" className="card scroll-mt-32 overflow-hidden" aria-label="Evidence">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">Evidence</h2>
        <span className="mono text-[11.5px] text-fg-3">
          {rows.length} {rows.length === 1 ? 'passage' : 'passages'}
        </span>
        <span className="ml-auto hidden text-[11.5px] text-fg-3 sm:inline">Click a row to locate it in the source</span>
      </header>

      {rows.length === 0 ? (
        <p className="border-t border-line px-4 py-3 text-[12.5px] leading-relaxed text-fg-2">
          {failedDetectors.length > 0
            ? `No evidence to show: ${failedDetectors.join(' and ')} did not complete, so no passage was returned. This is an incomplete screening, not a clean result.`
            : entityCount > 0
              ? `Neither Guard nor Inspect returned a passage. The ${entityCount} personal-data finding${
                  entityCount === 1 ? '' : 's'
                } this run masked are listed under Protect, and the forwarded copy shows what replaced them.`
              : 'Neither detector returned a passage for this content. That is not proof of safety — a detector can miss phrasing it has not seen, which is why the decision is not the detector’s to make.'}
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((row) => {
            const selected = focusId === row.id;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onLocate(row)}
                  aria-pressed={selected}
                  title={`Locate this passage in the source view (offsets ${row.start}–${row.end})`}
                  className={`group flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                    selected ? 'bg-accent-soft' : 'hover:bg-surface-2'
                  }`}
                >
                  <span
                    className={`mt-[3px] w-[56px] shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] ${
                      row.source === 'guard' ? 'text-block' : 'text-review'
                    }`}
                  >
                    {row.source}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="mono block break-words text-[12.5px] leading-[1.65] text-fg">“{row.excerpt}”</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-fg-3">
                      {row.placeable ? (
                        <span className="mono text-fg-2">L{row.line}</span>
                      ) : (
                        <span className="text-review">offsets outside the text — not placed</span>
                      )}
                      {row.confidence !== null ? (
                        <span title="Detector confidence">{pct(row.confidence, 0)}</span>
                      ) : null}
                      <span className="truncate">{row.label}</span>
                    </span>
                  </span>

                  <ChevronRightIcon
                    size={13}
                    className={`mt-1 shrink-0 transition-opacity ${
                      selected ? 'text-accent opacity-100' : 'text-fg-3 opacity-0 group-hover:opacity-100'
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
