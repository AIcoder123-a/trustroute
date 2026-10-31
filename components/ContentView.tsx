'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { AnalyzeResponse } from '@/lib/types';
import { isHighSensitivity } from '@/lib/redact';
import { KIND_CLASS, KIND_LABEL, buildSegments, type HighlightKind } from '@/lib/highlight';
import { comparisonLabel, comparisonTooltip } from '@/lib/copy';
import { byteSize } from '@/lib/format';
import { CopyIcon, CheckIcon, ScanIcon, ArrowRightIcon } from '@/components/icons';

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

const LEGEND: HighlightKind[] = ['injection', 'script', 'pii-high', 'pii'];

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
  const entityCount = result?.stages.protect.data?.entities.length ?? 0;
  const appliedCount = result?.redaction.applied.length ?? 0;
  const hasResult = Boolean(result);
  const charactersRemoved = groups.reduce((sum, group) => sum + group.characters, 0);

  // A click in the evidence panel should land on the passage, not on a tab.
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
    <section className="panel flex min-h-[190px] flex-col overflow-hidden sm:min-h-[260px]" aria-label="Content view">
      <header className="flex flex-wrap items-center gap-2 px-3.5 pt-2.5 pb-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel-2 p-0.5" role="tablist">
          {(['original', 'masked'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view === tab}
              onClick={() => setView(tab)}
              className={`h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors ${
                view === tab ? 'bg-panel-3 text-fg shadow-[inset_0_1px_0_#323842]' : 'text-fg-3 hover:text-fg-2'
              }`}
            >
              {tab === 'original' ? 'As received' : 'Forwarded copy'}
              {tab === 'masked' && hasResult ? (
                <span className="mono ml-1.5 text-[10.5px] text-fg-3">{appliedCount}</span>
              ) : null}
            </button>
          ))}
        </div>

        <span className="mono text-[11px] text-fg-3">
          {byteSize(text)} · {text.length.toLocaleString()} chars
        </span>

        {hasResult && entityCount > 0 ? (
          <span
            className={`chip h-[23px] px-2 text-[11px] ${
              result?.mode === 'live' && result.redaction.apiComparison === 'differs' ? 'border-[#6b5320] text-review' : ''
            }`}
            title={result ? comparisonTooltip(result.mode) : undefined}
          >
            {comparisonLabel(result!.mode, result!.redaction.apiComparison)}
          </span>
        ) : null}

        <button
          type="button"
          className="btn btn-quiet ml-auto h-7 px-2 text-[11.5px]"
          onClick={() => copy(view === 'masked' && masked ? masked : text)}
          disabled={view === 'masked' && !masked}
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          {copied ? 'Copied' : view === 'masked' ? 'Copy masked' : 'Copy text'}
        </button>
      </header>
      <div className="h-px w-full bg-line" />

      {hasResult && entityCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 bg-panel-2/60 px-3.5 py-2">
          <span className="text-[11.5px] text-fg-2">
            <span className="mono text-fg">{appliedCount}</span> value{appliedCount === 1 ? '' : 's'} masked
          </span>
          <span className="text-[11px] text-fg-3">
            · {groups.length} kind{groups.length === 1 ? '' : 's'} · {charactersRemoved.toLocaleString()} chars removed
          </span>
          <button
            type="button"
            onClick={() => setView(view === 'masked' ? 'original' : 'masked')}
            className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
          >
            {view === 'masked' ? 'See what arrived' : 'See what the agent gets'}
            <ArrowRightIcon size={11} />
          </button>
        </div>
      ) : null}

      <div ref={scrollerRef} className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3.5">
        {view === 'masked' ? (
          masked ? (
            <div className="space-y-2.5">
              {groups.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="label mr-0.5">Mask map · {appliedCount}</span>
                  {groups.map((group) => (
                    <button
                      key={group.type}
                      type="button"
                      onClick={() => onLocate?.({ ...group.first, type: group.type })}
                      disabled={!onLocate}
                      title="Show this replacement in the original text"
                      className="chip h-[25px] gap-1.5 px-2 transition-colors hover:border-line-strong hover:text-fg disabled:cursor-default"
                    >
                      <span className={`mono text-[11px] ${isHighSensitivity(group.type) ? 'text-[#f0c48a]' : 'text-[#8be6d3]'}`}>
                        {group.type}
                      </span>
                      <ArrowRightIcon size={10} className="text-fg-3" />
                      <span className="mono text-[11px] text-fg-2">{group.token}</span>
                      <span className="mono text-[10.5px] text-fg-3">×{group.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <pre className="mono whitespace-pre-wrap break-words text-[13px] leading-[1.72] text-fg">
                {maskedParts.map((part, index) =>
                  part.token ? (
                    <mark
                      key={index}
                      className="rounded-[3px] bg-[#12332e] px-0.5 text-[#8be6d3]"
                      title="Replaced by TrustRoute before forwarding"
                    >
                      {part.text}
                    </mark>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )}
              </pre>
            </div>
          ) : (
            <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-[12.5px] leading-relaxed text-fg-3">
              No forwarded copy. Protect returned no findings, or a masked copy could not be built from the spans — in
              which case policy will not allow the original through in its place.
            </div>
          )
        ) : (
          <pre className="mono whitespace-pre-wrap break-words text-[13px] leading-[1.72] text-fg-2">
            {hasResult
              ? segments.map((segment, index) =>
                  segment.kind === 'plain' ? (
                    <span key={index}>{segment.text}</span>
                  ) : (
                    <mark
                      key={index}
                      data-start={segment.start}
                      className={`${KIND_CLASS[segment.kind]} px-0.5 ${
                        focusStart !== null && segment.start === focusStart
                          ? 'outline outline-1 outline-offset-1 outline-accent'
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

      {hasResult ? (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3.5 py-2">
          {LEGEND.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5 text-[11px] text-fg-3">
              <span className={`inline-block size-2 rounded-[2px] ${KIND_CLASS[kind]}`} aria-hidden="true" />
              {KIND_LABEL[kind]}
            </span>
          ))}
          {result?.redaction.dropped.length || result?.redaction.rejected.length ? (
            <span className="ml-auto text-[11px] text-review">
              {result?.redaction.dropped.length ?? 0} overlapping · {result?.redaction.rejected.length ?? 0} rejected
              span(s) reconciled
            </span>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-fg-3">
              <ScanIcon size={10} />
              click a finding below to locate it here
            </span>
          )}
        </footer>
      ) : null}
    </section>
  );
}
