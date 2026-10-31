'use client';

import type { AnalyzeResponse } from '@/lib/types';
import { buildEvidenceRows, type EvidenceRow } from '@/lib/evidence';
import { pct } from '@/lib/format';
import { CodeIcon, ScanIcon } from '@/components/icons';

const SOURCE_TONE: Record<EvidenceRow['source'], { tag: string; ring: string; icon: typeof ScanIcon }> = {
  guard: {
    tag: 'border-[#6d2a30] bg-[#2c1216] text-[#ff9aa0]',
    ring: 'hover:border-[#6d2a30] hover:bg-[#1b0f11]',
    icon: ScanIcon,
  },
  inspect: {
    tag: 'border-[#3d2f16] bg-[#1d1709] text-[#f2cf8a]',
    ring: 'hover:border-[#3d2f16] hover:bg-[#1d1709]',
    icon: CodeIcon,
  },
};

/**
 * The passage-level evidence behind Guard and Inspect, in one list.
 *
 * Each row is a real span in the text the reviewer pasted — not a summary — and
 * clicking it locates that span in the source view above. Rows whose offsets do
 * not fit the text are still shown, marked as unplaced: hiding them would look
 * like the detector found nothing there.
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

  if (rows.length === 0) {
    return (
      <section className="panel overflow-hidden" aria-label="Evidence">
        <header className="flex items-center gap-2 border-b border-line px-3.5 py-2">
          <h2 className="text-[12px] font-semibold tracking-tight text-fg-2">Evidence</h2>
          <span className="mono text-[10px] text-fg-3">0 passages</span>
        </header>
        <p className="px-3.5 py-2.5 text-[11.5px] leading-relaxed text-fg-3">
          Neither detector returned a passage for this content. That is not proof of safety — a detector can miss
          phrasing it has not seen, which is why the decision is not the detector&apos;s to make.
        </p>
      </section>
    );
  }

  return (
    <section className="panel overflow-hidden" aria-label="Evidence">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2">
        <h2 className="text-[12px] font-semibold tracking-tight text-fg-2">Evidence</h2>
        <span className="mono text-[10px] text-fg-3">
          {rows.length} {rows.length === 1 ? 'passage' : 'passages'}
        </span>
        <span className="ml-auto text-[10.5px] text-fg-3">click a row to locate it in the source</span>
      </header>

      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const tone = SOURCE_TONE[row.source];
          const Icon = tone.icon;
          const selected = focusId === row.id;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onLocate(row)}
                aria-pressed={selected}
                className={`flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition-colors ${tone.ring} ${
                  selected ? 'bg-panel-2' : ''
                }`}
              >
                <span
                  className={`mt-[1px] inline-flex h-[18px] shrink-0 items-center gap-1 rounded border px-1.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] ${tone.tag}`}
                >
                  <Icon size={9} />
                  {row.source}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="mono block break-words text-[11.5px] leading-relaxed text-fg">
                    “{row.excerpt}”
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-fg-3">
                    {row.placeable ? (
                      <span className="mono">L{row.line}</span>
                    ) : (
                      <span className="text-review">offsets outside the text — not placed</span>
                    )}
                    <span className="mono">
                      {row.start}–{row.end}
                    </span>
                    {row.confidence !== null ? <span>confidence {pct(row.confidence, 0)}</span> : null}
                    <span className="truncate">{row.label}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
