'use client';

import type { ContentType, DemoCase } from '@/lib/types';
import { CONTENT_TYPE_LABELS } from '@/lib/types';

const TYPE_SHORT: Record<ContentType, string> = {
  support_ticket: 'Ticket',
  web_content: 'Web page',
  tool_output: 'Tool output',
  script: 'Script',
};

/**
 * The demo cases, as a single row of quiet chips.
 *
 * They are a starting point, not a navigation surface: one click loads the
 * text, and the reader still chooses when to screen it.
 */
export function CasePicker({
  cases,
  activeId,
  onSelect,
}: {
  cases: DemoCase[];
  activeId: string | null;
  onSelect: (item: DemoCase) => void;
}) {
  return (
    <section aria-label="Demo cases">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="label">Try a sample</h2>
        <span className="text-[11.5px] text-fg-3">Synthetic content · nothing from a real person</span>
      </div>
      <ul data-testid="case-list" className="-mx-1 flex min-w-0 snap-x gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
        {cases.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id} className="snap-start">
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-current={active ? 'true' : undefined}
                title={item.summary}
                className={`flex h-[46px] shrink-0 flex-col justify-center rounded-lg border px-2.5 text-left transition-colors ${
                  active
                    ? 'border-accent-line bg-accent-soft'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
                }`}
              >
                <span className={`whitespace-nowrap text-[12px] font-medium ${active ? 'text-accent' : 'text-fg'}`}>
                  {item.title}
                </span>
                <span className="mt-0.5 whitespace-nowrap text-[10.5px] text-fg-3">
                  {TYPE_SHORT[item.contentType]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
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
    <div
      className="grid grid-cols-2 gap-0.5 rounded-lg bg-surface-2 p-0.5 sm:flex"
      role="radiogroup"
      aria-label="Content type"
    >
      {entries.map(([key, label]) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(key)}
            className={`h-7 whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
              selected
                ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(14,26,24,0.08)]'
                : 'text-fg-3 hover:text-fg-2'
            }`}
          >
            {TYPE_SHORT[key]}
          </button>
        );
      })}
    </div>
  );
}
