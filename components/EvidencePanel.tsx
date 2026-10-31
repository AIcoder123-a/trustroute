'use client';

import type { AnalyzeResponse } from '@/lib/types';
import { buildEvidenceRows, type EvidenceRow } from '@/lib/evidence';
import { pct } from '@/lib/format';
import { evidenceBadge, evidenceHint } from '@/lib/copy';
import { ArrowRightIcon, CodeIcon, ScanIcon } from '@/components/icons';

const SOURCE_TONE: Record<EvidenceRow['source'], { tag: string; bar: string; icon: typeof ScanIcon }> = {
  guard: {
    tag: 'border-[#6d2a30] bg-[#2c1216] text-[#ff9aa0]',
    bar: 'bg-[#f0575f]',
    icon: ScanIcon,
  },
  inspect: {
    tag: 'border-[#3d2f16] bg-[#1d1709] text-[#f2cf8a]',
    bar: 'bg-[#e5a83c]',
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
  const badge = evidenceBadge(result.mode);
  const entityCount = result.stages.protect.data?.entities.length ?? 0;

  if (rows.length === 0) {
    return (
      <section id="evidence" className="panel scroll-mt-[72px] overflow-hidden" aria-label="Evidence">
        <header className="flex items-center gap-2 px-3.5 py-2.5">
          <h2 className="text-[12.5px] font-semibold tracking-tight text-fg-2">Evidence</h2>
          <span className="mono text-[10.5px] text-fg-3">0 passages</span>
        </header>
        <p className="border-t border-line px-3.5 py-2.5 text-[12px] leading-relaxed text-fg-3">
          {entityCount > 0
            ? `Neither Guard nor Inspect returned a passage. The ${entityCount} personal-data finding${
                entityCount === 1 ? '' : 's'
              } this run masked are listed under Protect, and the forwarded copy above shows what replaced them.`
            : 'Neither detector returned a passage for this content. That is not proof of safety — a detector can miss phrasing it has not seen, which is why the decision is not the detector’s to make.'}
        </p>
      </section>
    );
  }

  return (
    <section id="evidence" className="panel scroll-mt-[72px] overflow-hidden" aria-label="Evidence">
      <header className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <h2 className="text-[12.5px] font-semibold tracking-tight text-fg-2">Evidence</h2>
        <span className="mono text-[10.5px] text-fg-3">
          {rows.length} {rows.length === 1 ? 'passage' : 'passages'}
        </span>
        {badge ? (
          <span className="rounded border border-[#5a4a1c] bg-[#26200f] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-review">
            {badge}
          </span>
        ) : null}
        <span className="ml-auto hidden text-[10.5px] text-fg-3 sm:inline">{evidenceHint(result.mode)}</span>
      </header>

      <ul className="divide-y divide-line border-t border-line">
        {rows.map((row) => {
          const tone = SOURCE_TONE[row.source];
          const Icon = tone.icon;
          const selected = focusId === row.id;
          return (
            <li key={row.id} className="relative">
              <button
                type="button"
                onClick={() => onLocate(row)}
                aria-pressed={selected}
                title="Locate this passage in the source view"
                className={`group flex w-full items-start gap-3 py-2.5 pr-3 pl-3.5 text-left transition-colors ${
                  selected ? 'bg-panel-3' : 'hover:bg-panel-2'
                }`}
              >
                <span className={`absolute inset-y-0 left-0 w-[2px] ${selected ? tone.bar : 'bg-transparent'}`} aria-hidden="true" />

                <span
                  className={`mt-[1px] inline-flex h-[18px] shrink-0 items-center gap-1 rounded border px-1.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] ${tone.tag}`}
                >
                  <Icon size={9} />
                  {row.source}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="mono block break-words text-[12px] leading-relaxed text-fg">“{row.excerpt}”</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px] text-fg-3">
                    {row.placeable ? (
                      <span className="mono text-fg-2">L{row.line}</span>
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

                <ArrowRightIcon
                  size={12}
                  className={`mt-1 shrink-0 transition-opacity ${selected ? 'text-accent opacity-100' : 'text-fg-3 opacity-0 group-hover:opacity-100'}`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
