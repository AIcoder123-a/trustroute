'use client';

import type { ContentType, DemoCase } from '@/lib/types';
import { CONTENT_TYPE_LABELS } from '@/lib/types';

const TYPE_GLYPH: Record<ContentType, string> = {
  support_ticket: 'TK',
  web_content: 'WEB',
  tool_output: 'TOOL',
  script: 'SH',
};

export function CaseRail({
  cases,
  activeId,
  onSelect,
}: {
  cases: DemoCase[];
  activeId: string | null;
  onSelect: (item: DemoCase) => void;
}) {
  return (
    <nav aria-label="Demo cases" data-testid="case-list" className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <h2 className="text-[12.5px] font-semibold tracking-tight text-fg">Demo cases</h2>
        <span className="mono text-[10px] text-fg-3">{cases.length}</span>
      </header>
      <ul className="divide-y divide-line">
        {cases.map((item, index) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-current={active ? 'true' : undefined}
                className={`group flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors ${
                  active ? 'bg-[#12251f]' : 'hover:bg-panel-2'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`mono text-[9.5px] tabular-nums ${active ? 'text-accent' : 'text-fg-3'}`}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={`flex-1 truncate text-[12.5px] font-medium ${active ? 'text-fg' : 'text-fg-2'}`}>
                    {item.title}
                  </span>
                  <span className="mono shrink-0 rounded border border-line px-1 py-px text-[8.5px] tracking-wide text-fg-3">
                    {TYPE_GLYPH[item.contentType]}
                  </span>
                </div>
                <p className="line-clamp-2 pl-[26px] text-[11.5px] leading-snug text-fg-3">{item.summary}</p>
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="border-t border-line px-3 py-2">
        <p className="text-[11px] leading-relaxed text-fg-3">
          All cases are synthetic. Nothing here came from a real customer, mailbox or endpoint.
        </p>
      </footer>
    </nav>
  );
}

export function CaseStrip({
  cases,
  activeId,
  onSelect,
}: {
  cases: DemoCase[];
  activeId: string | null;
  onSelect: (item: DemoCase) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h2 className="label">Demo cases</h2>
        <span className="text-[10px] text-fg-3">synthetic</span>
      </div>
      <ul data-testid="case-list" className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
        {cases.map((item, index) => {
          const active = item.id === activeId;
          return (
            <li key={item.id} className="snap-start">
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-current={active ? 'true' : undefined}
                className={`flex h-[52px] w-[168px] flex-col justify-center rounded-lg border px-2.5 text-left transition-colors ${
                  active
                    ? 'border-[#2a5f54] bg-[#12251f]'
                    : 'border-line bg-panel hover:border-line-strong'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`mono text-[9px] ${active ? 'text-accent' : 'text-fg-3'}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={`truncate text-[11.5px] font-medium ${active ? 'text-fg' : 'text-fg-2'}`}>
                    {item.title}
                  </span>
                </span>
                <span className="mt-0.5 truncate text-[10px] text-fg-3">{CONTENT_TYPE_LABELS[item.contentType]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ContentTypeTabs({
  value,
  onChange,
  disabled,
}: {
  value: ContentType;
  onChange: (value: ContentType) => void;
  disabled?: boolean;
}) {
  const entries = Object.entries(CONTENT_TYPE_LABELS) as [ContentType, string][];
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Content type">
      {entries.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          disabled={disabled}
          onClick={() => onChange(key)}
          className={`h-7 rounded-md border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
            value === key
              ? 'border-[#2a5f54] bg-[#12332e] text-[#8be6d3]'
              : 'border-line bg-panel-2 text-fg-3 hover:text-fg-2'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
