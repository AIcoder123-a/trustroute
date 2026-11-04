'use client';

import { useState } from 'react';

import type { ContentType, DemoCase } from '@/lib/types';
import { CONTENT_TYPE_LABELS } from '@/lib/types';
import { ChevronRightIcon } from '@/components/icons';

const TYPE_SHORT: Record<ContentType, string> = {
  support_ticket: 'Ticket',
  web_content: 'Web page',
  tool_output: 'Tool output',
  script: 'Script',
};

/**
 * Three examples are on the first screen; the rest are one click away.
 *
 * A demo that lists eight cases before the reader has screened anything looks
 * like a test harness. The three that remain cover the three outcomes a reader
 * needs to recognise — clean, masked, blocked — and the other five stay
 * reachable without competing for attention.
 */
const FEATURED = ['safe-support', 'pii-ticket', 'injection-classic'];

export function CasePicker({
  cases,
  activeId,
  onSelect,
}: {
  cases: DemoCase[];
  activeId: string | null;
  onSelect: (item: DemoCase) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const featured = FEATURED.map((id) => cases.find((item) => item.id === id)).filter(
    (item): item is DemoCase => item !== undefined,
  );
  // Anything not featured, plus anything the featured list could not resolve —
  // a renamed case must still be reachable.
  const rest = cases.filter((item) => !featured.some((entry) => entry.id === item.id));
  const shown = expanded ? [...featured, ...rest] : featured;

  return (
    <section aria-label="Demo cases">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="label">Try a sample</h2>
        <span className="text-[11.5px] text-fg-3">Synthetic content · nothing from a real person</span>
      </div>

      <ul data-testid="case-list" className="grid min-w-0 gap-1.5 sm:grid-cols-3">
        {shown.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-current={active ? 'true' : undefined}
                title={item.summary}
                className={`flex h-[52px] w-full flex-col justify-center rounded-lg border px-3 text-left transition-colors ${
                  active
                    ? 'border-accent-line bg-accent-soft'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
                }`}
              >
                <span className={`truncate text-[12.5px] font-medium ${active ? 'text-accent' : 'text-fg'}`}>
                  {item.title}
                </span>
                <span className="mt-0.5 text-[11px] text-fg-3">{TYPE_SHORT[item.contentType]}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {rest.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-fg-2 transition-colors hover:text-fg"
        >
          <ChevronRightIcon
            size={11}
            className={`text-fg-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          {expanded ? 'Show fewer examples' : `More examples (${rest.length})`}
        </button>
      ) : null}
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
            className={`h-8 whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
              selected ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(14,26,24,0.08)]' : 'text-fg-3 hover:text-fg-2'
            }`}
          >
            {TYPE_SHORT[key]}
          </button>
        );
      })}
    </div>
  );
}
