'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { AnalyzeResponse } from '@/lib/types';
import { isHighSensitivity } from '@/lib/redact';
import { KIND_CLASS, KIND_LABEL, buildSegments, type HighlightKind } from '@/lib/highlight';
import { byteSize } from '@/lib/format';
import { CopyIcon, CheckIcon, ScanIcon } from '@/components/icons';

type View = 'original' | 'masked';

export interface FocusSpan {
  start: number;
  end: number;
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
  const groups = new Map<string, { type: string; token: string; count: number; characters: number }>();
  for (const span of result.redaction.applied) {
    const token = `<${span.type.toUpperCase()}>`;
    const current = groups.get(span.type);
    if (current) {
      current.count += 1;
      current.characters += span.end - span.start;
    } else {
      groups.set(span.type, { type: span.type, token, count: 1, characters: span.end - span.start });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function ContentView({
  result,
  text,
  focus,
}: {
  result: AnalyzeResponse | null;
  text: string;
  focus: FocusSpan | null;
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
  const hasResult = Boolean(result);

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
    <section className="panel flex min-h-[170px] flex-col overflow-hidden sm:min-h-[240px]" aria-label="Content view">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2">
        <div className="flex items-center gap-0.5 rounded-md border border-line bg-panel-2 p-0.5" role="tablist">
          {(['original', 'masked'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view === tab}
              onClick={() => setView(tab)}
              className={`h-6 rounded px-2.5 text-[11.5px] font-medium transition-colors ${
                view === tab ? 'bg-panel-3 text-fg' : 'text-fg-3 hover:text-fg-2'
              }`}
            >
              {tab === 'original' ? 'As received' : 'Forwarded copy'}
            </button>
          ))}
        </div>

        <span className="mono text-[10.5px] text-fg-3">
          {byteSize(text)} · {text.length.toLocaleString()} chars
        </span>

        {hasResult && entityCount > 0 ? (
          <span
            className={`chip h-[22px] px-2 text-[10.5px] ${
              result?.redaction.apiComparison === 'differs' ? 'border-[#6b5320] text-review' : ''
            }`}
          >
            {result?.redaction.apiComparison === 'differs'
              ? 'Clocked copy differs — local copy used'
              : result?.redaction.apiComparison === 'match'
                ? 'Matches Clocked anonymized_text'
                : 'Built from Protect spans'}
          </span>
        ) : null}

        <button
          type="button"
          className="btn btn-quiet ml-auto h-6 px-2 text-[11px]"
          onClick={() => copy(view === 'masked' && masked ? masked : text)}
          disabled={view === 'masked' && !masked}
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          {copied ? 'Copied' : view === 'masked' ? 'Copy masked' : 'Copy text'}
        </button>
      </header>

      <div ref={scrollerRef} className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3.5">
        {view === 'masked' ? (
          masked ? (
            <div className="space-y-3">
              <pre className="mono whitespace-pre-wrap break-words text-[12.5px] leading-[1.75] text-fg">
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

              {groups.length > 0 ? (
                <div className="overflow-hidden rounded border border-line">
                  <div className="flex items-center justify-between border-b border-line bg-panel-2 px-2.5 py-1.5">
                    <span className="label">Mask map · {result?.redaction.applied.length ?? 0} replacements</span>
                    <span className="text-[10px] text-fg-3">
                      {groups.reduce((sum, group) => sum + group.characters, 0).toLocaleString()} characters replaced
                    </span>
                  </div>
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-panel-2/60 text-[9.5px] uppercase tracking-[0.08em] text-fg-3">
                        <th className="px-2.5 py-1 font-semibold">Kind</th>
                        <th className="px-2.5 py-1 font-semibold">Becomes</th>
                        <th className="w-[52px] px-2.5 py-1 text-right font-semibold">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((group) => (
                        <tr key={group.type} className="border-t border-line">
                          <td className="px-2.5 py-1">
                            <span
                              className={`mono text-[11px] ${isHighSensitivity(group.type) ? 'text-[#f0c48a]' : 'text-[#8be6d3]'}`}
                            >
                              {group.type}
                            </span>
                          </td>
                          <td className="mono px-2.5 py-1 text-[11px] text-fg-2">{group.token}</td>
                          <td className="mono px-2.5 py-1 text-right text-[11px] text-fg-3">×{group.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-[12.5px] leading-relaxed text-fg-3">
              No forwarded copy. Protect returned no findings, or a masked copy could not be built from the spans — in
              which case policy will not allow the original through in its place.
            </div>
          )
        ) : (
          <pre className="mono whitespace-pre-wrap break-words text-[12.5px] leading-[1.75] text-fg-2">
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
            <span key={kind} className="inline-flex items-center gap-1.5 text-[10.5px] text-fg-3">
              <span className={`inline-block size-2 rounded-[2px] ${KIND_CLASS[kind]}`} aria-hidden="true" />
              {KIND_LABEL[kind]}
            </span>
          ))}
          {result?.redaction.dropped.length || result?.redaction.rejected.length ? (
            <span className="ml-auto text-[10.5px] text-review">
              {result?.redaction.dropped.length ?? 0} overlapping · {result?.redaction.rejected.length ?? 0} rejected
              span(s) reconciled
            </span>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-fg-3">
              <ScanIcon size={10} />
              click a finding below to locate it here
            </span>
          )}
        </footer>
      ) : null}
    </section>
  );
}
