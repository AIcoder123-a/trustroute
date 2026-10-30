'use client';

import { useMemo, useState } from 'react';

import type { AnalyzeResponse } from '@/lib/types';
import { KIND_CLASS, KIND_LABEL, buildSegments, type HighlightKind } from '@/lib/highlight';
import { byteSize } from '@/lib/format';
import { CopyIcon, CheckIcon } from '@/components/icons';

type View = 'original' | 'masked';

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

export function ContentView({ result, text }: { result: AnalyzeResponse | null; text: string }) {
  const [view, setView] = useState<View>('original');
  const { copied, copy } = useCopy();

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

  const entityCount = result?.stages.protect.data?.entities.length ?? 0;
  const hasResult = Boolean(result);

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

      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3.5">
        {view === 'masked' ? (
          masked ? (
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
                      className={`${KIND_CLASS[segment.kind]} px-0.5`}
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
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
