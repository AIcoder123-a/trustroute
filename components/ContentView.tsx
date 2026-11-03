'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { AnalyzeResponse } from '@/lib/types';
import { isHighSensitivity } from '@/lib/redact';
import { KIND_LABEL, buildSegments, type HighlightKind } from '@/lib/highlight';
import { comparisonLabel, comparisonTooltip } from '@/lib/copy';
import { CopyIcon, CheckIcon } from '@/components/icons';

type View = 'original' | 'masked';

export interface FocusSpan {
  start: number;
  end: number;
}

export interface LocateSpan {
  start: number;
  end: number;
  type: string;
}

/** Three swatches, not four: both personal-data kinds are the same category. */
const LEGEND: { label: string; swatch: string }[] = [
  { label: KIND_LABEL.injection, swatch: 'bg-[#c0494f]' },
  { label: KIND_LABEL.script, swatch: 'bg-[#b3801f]' },
  { label: 'Personal data', swatch: 'bg-[#1f8f79]' },
];

/**
 * Dark highlights, light chrome.
 *
 * The reader is the one surface that stays dark: it is scanned character by
 * character, and a dark ground keeps the four highlight kinds distinguishable
 * without turning the page into a rainbow.
 */
const DARK_KIND_CLASS: Record<HighlightKind, string> = {
  plain: '',
  pii: 'rounded-[3px] bg-[#12352f] px-0.5 text-[#9fe8d6]',
  'pii-high': 'rounded-[3px] bg-[#3c2a10] px-0.5 text-[#f3ce8d]',
  injection: 'rounded-[3px] bg-[#3d1a1e] px-0.5 text-[#ffb3b7]',
  script: 'rounded-[3px] bg-[#3a2c12] px-0.5 text-[#f2d59a]',
};

function useCopy() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        setCopied(false);
      }
    },
  };
}

/** Grouped replacements: what each entity kind became in the forwarded copy. */
function maskMap(result: AnalyzeResponse) {
  const groups = new Map<
    string,
    { type: string; token: string; count: number; characters: number; first: { start: number; end: number } }
  >();
  for (const span of result.redaction.applied) {
    const token = `<${span.type.toUpperCase()}>`;
    const current = groups.get(span.type);
    if (current) {
      current.count += 1;
      current.characters += span.end - span.start;
    } else {
      groups.set(span.type, {
        type: span.type,
        token,
        count: 1,
        characters: span.end - span.start,
        first: { start: span.start, end: span.end },
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function ContentView({
  result,
  text,
  focus,
  onLocate,
}: {
  result: AnalyzeResponse | null;
  text: string;
  focus: FocusSpan | null;
  onLocate?: (span: LocateSpan) => void;
}) {
  const [view, setView] = useState<View>('original');
  const { copied, copy } = useCopy();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const segments = useMemo(() => {
    if (!result) return [];
    return buildSegments(text, {
      entities: result.stages.protect.data?.entities ?? [],
      guard: result.stages.guard.data,
      inspect: result.stages.inspect.data,
    });
  }, [result, text]);

  const masked = result?.redaction.maskedText ?? null;

  const maskedParts = useMemo(() => {
    if (!masked) return [];
    const parts: { text: string; token: boolean }[] = [];
    const regex = /<[A-Z0-9_]+>/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(masked)) !== null) {
      if (match.index > cursor) parts.push({ text: masked.slice(cursor, match.index), token: false });
      parts.push({ text: match[0], token: true });
      cursor = match.index + match[0].length;
    }
    if (cursor < masked.length) parts.push({ text: masked.slice(cursor), token: false });
    return parts;
  }, [masked]);

  const groups = useMemo(() => (result ? maskMap(result) : []), [result]);
  const appliedCount = result?.redaction.applied.length ?? 0;
  const entityCount = result?.stages.protect.data?.entities.length ?? 0;

  // A click in the evidence list should land on the passage, not on a tab.
  const focusStart = focus?.start ?? null;
  const focusEnd = focus?.end ?? null;
  useEffect(() => {
    if (focusStart === null || focusEnd === null) return;
    setView('original');
    const frame = requestAnimationFrame(() => {
      const node = scrollerRef.current?.querySelector<HTMLElement>(`[data-start="${focusStart}"]`);
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusStart, focusEnd]);

  return (
    <section className="card overflow-hidden" aria-label="Content view">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5" role="tablist">
          {(['original', 'masked'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view === tab}
              aria-label={tab === 'masked' ? 'Forwarded copy' : 'As received'}
              onClick={() => setView(tab)}
              className={`h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors ${
                view === tab ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(14,26,24,0.08)]' : 'text-fg-3 hover:text-fg-2'
              }`}
            >
              {tab === 'original' ? 'As received' : 'Forwarded copy'}
              {tab === 'masked' ? <span className="mono ml-1.5 text-[10.5px] text-fg-3">{appliedCount}</span> : null}
            </button>
          ))}
        </div>

        <span className="mono text-[11px] text-fg-3">
          {text.length.toLocaleString()} chars
        </span>

        <button
          type="button"
          className="btn btn-ghost btn-sm ml-auto"
          onClick={() => copy(view === 'masked' && masked ? masked : text)}
          disabled={view === 'masked' && !masked}
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          {copied ? 'Copied' : view === 'masked' ? 'Copy masked' : 'Copy'}
        </button>
      </header>

      {result && entityCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-surface-2/50 px-4 py-1.5">
          <span className="text-[11.5px] text-fg-2">
            <span className="mono text-fg">{appliedCount}</span> value{appliedCount === 1 ? '' : 's'} masked
          </span>
          <span className="text-[11px] text-fg-3" title={comparisonTooltip(result.mode)}>
            · {comparisonLabel(result.mode, result.redaction.apiComparison)}
          </span>
          <button
            type="button"
            onClick={() => setView(view === 'masked' ? 'original' : 'masked')}
            className="ml-auto text-[11.5px] font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
          >
            {view === 'masked' ? 'See what arrived' : 'See what the agent gets'}
          </button>
        </div>
      ) : null}

      {view === 'masked' && groups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-surface-2/60 px-4 py-2">
          <span className="label mr-0.5">Mask map · {appliedCount}</span>
          {groups.map((group) => (
            <button
              key={group.type}
              type="button"
              onClick={() => onLocate?.({ ...group.first, type: group.type })}
              disabled={!onLocate}
              title="Show this replacement in the original text"
              className="inline-flex h-[24px] items-center gap-1.5 rounded-md border border-line bg-surface px-2 transition-colors hover:border-line-strong disabled:cursor-default"
            >
              <span
                className={`mono text-[11px] ${isHighSensitivity(group.type) ? 'text-review' : 'text-accent'}`}
              >
                {group.type}
              </span>
              <span className="mono text-[11px] text-fg-2">{group.token}</span>
              <span className="mono text-[10.5px] text-fg-3">×{group.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={scrollerRef}
        className="scroll-dark max-h-[460px] min-h-[180px] overflow-auto bg-code px-4 py-4 sm:px-5"
      >
        {view === 'masked' ? (
          masked ? (
            <pre className="mono whitespace-pre-wrap break-words text-[12px] leading-[1.8] text-code-fg sm:text-[13px]">
              {maskedParts.map((part, index) =>
                part.token ? (
                  <mark
                    key={index}
                    className="rounded-[3px] bg-[#12352f] px-0.5 text-[#9fe8d6]"
                    title="Replaced by TrustRoute before forwarding"
                  >
                    {part.text}
                  </mark>
                ) : (
                  <span key={index}>{part.text}</span>
                ),
              )}
            </pre>
          ) : (
            <div className="flex min-h-[140px] items-center justify-center px-4 text-center text-[12.5px] leading-relaxed text-code-fg-2">
              {result?.stages.protect.status !== 'ok'
                ? 'No forwarded copy: Protect did not complete, so nothing was masked and nothing may be forwarded. This run reports screening unavailable.'
                : 'No forwarded copy. Protect returned no findings, or a masked copy could not be built from the spans — in which case policy will not allow the original through in its place.'}
            </div>
          )
        ) : (
          <pre className="mono whitespace-pre-wrap break-words text-[12px] leading-[1.8] text-code-fg sm:text-[13px]-2">
            {result
              ? segments.map((segment, index) =>
                  segment.kind === 'plain' ? (
                    <span key={index}>{segment.text}</span>
                  ) : (
                    <mark
                      key={index}
                      data-start={segment.start}
                      className={`${DARK_KIND_CLASS[segment.kind]} ${
                        focusStart !== null && segment.start === focusStart
                          ? 'outline outline-1 outline-offset-1 outline-[#7fe3cf]'
                          : ''
                      }`}
                      title={segment.label ? `${KIND_LABEL[segment.kind]} · ${segment.label}` : KIND_LABEL[segment.kind]}
                    >
                      {segment.text}
                    </mark>
                  ),
                )
              : text}
          </pre>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-4 py-2">
        {LEGEND.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5 text-[11px] text-fg-3">
            <span className={`inline-block size-2 rounded-[2px] ${item.swatch}`} aria-hidden="true" />
            {item.label}
          </span>
        ))}
        {result && (result.redaction.dropped.length > 0 || result.redaction.rejected.length > 0) ? (
          <span className="ml-auto text-[11px] text-review">
            {result.redaction.dropped.length} overlapping · {result.redaction.rejected.length} rejected span(s)
            reconciled
          </span>
        ) : null}
      </footer>
    </section>
  );
}
