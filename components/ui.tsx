import type { ReactNode } from 'react';

import type { Decision, StageStatus } from '@/lib/types';
import { pct } from '@/lib/format';

export const DECISION_STYLE: Record<Decision, { text: string; bg: string; border: string; dot: string }> = {
  PASS: { text: 'text-pass', bg: 'bg-[#0d2720]', border: 'border-[#1d5745]', dot: 'bg-pass' },
  REVIEW: { text: 'text-review', bg: 'bg-[#2a2110]', border: 'border-[#6b5320]', dot: 'bg-review' },
  BLOCK: { text: 'text-block', bg: 'bg-[#2c1216]', border: 'border-[#6d2a30]', dot: 'bg-block' },
};

export function DecisionBadge({ decision, large = false }: { decision: Decision; large?: boolean }) {
  const style = DECISION_STYLE[decision];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border font-semibold tracking-tight ${style.bg} ${style.border} ${style.text} ${
        large ? 'h-10 px-3.5 text-[15px]' : 'h-7 px-2.5 text-[12px]'
      }`}
    >
      <span className={`${large ? 'size-2' : 'size-1.5'} rounded-full ${style.dot}`} />
      {decision}
    </span>
  );
}

/**
 * A run that produced no usable risk verdict.
 *
 * Deliberately not `REVIEW`: REVIEW means a detector found something a human
 * should read. This means nothing was assessed, and the interface must not let
 * a reader conflate the two.
 */
export function UnavailableBadge({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border border-[#6b5320] bg-[#221a0d] font-semibold tracking-tight text-[#f0c48a] ${
        large ? 'h-10 px-3.5 text-[15px]' : 'h-7 px-2.5 text-[11.5px] uppercase tracking-[0.06em]'
      }`}
    >
      <span className={`${large ? 'size-2' : 'size-1.5'} rounded-full bg-review`} />
      Unavailable
    </span>
  );
}

const STATUS_STYLE: Record<StageStatus, string> = {
  ok: 'text-fg-2',
  error: 'text-block',
  timeout: 'text-review',
  unauthorized: 'text-block',
  quota: 'text-review',
  invalid: 'text-block',
  skipped: 'text-fg-3',
};

export function StatusDot({ status }: { status: StageStatus }) {
  const color =
    status === 'ok'
      ? 'bg-pass'
      : status === 'skipped'
        ? 'bg-fg-3/50'
        : status === 'timeout' || status === 'quota'
          ? 'bg-review'
          : 'bg-block';
  return <span className={`inline-block size-1.5 rounded-full ${color}`} aria-hidden="true" />;
}

export function StatusText({ status, label }: { status: StageStatus; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11.5px] ${STATUS_STYLE[status]}`}>
      <StatusDot status={status} />
      {label}
    </span>
  );
}

/**
 * A probability meter with the detector line and the policy block line
 * marked, so the reader can see *why* a number became a decision.
 */
export function ProbabilityMeter({
  value,
  threshold,
  blockAt,
  tone,
  thresholdLabel = 'reference line',
}: {
  value: number;
  threshold: number;
  blockAt: number;
  tone: 'block' | 'review';
  /** What the first marker is: the endpoint's own threshold, or the simulator's. */
  thresholdLabel?: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div className="relative mt-2 h-[6px] w-full overflow-hidden rounded-full bg-panel-3">
      <div
        className={`h-full rounded-full ${tone === 'block' ? 'bg-block' : 'bg-review'}`}
        style={{ width: `${clamped * 100}%` }}
      />
      <div
        className="absolute top-0 h-full w-px bg-fg/40"
        style={{ left: `${threshold * 100}%` }}
        title={`${thresholdLabel} ${pct(threshold)}`}
      />
      <div
        className="absolute top-0 h-full w-px bg-fg/25"
        style={{ left: `${blockAt * 100}%` }}
        title={`Policy block line ${pct(blockAt)}`}
      />
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label mb-1">{label}</div>
      <div className="text-[12.5px] text-fg-2">{children}</div>
    </div>
  );
}

export function Divider() {
  return <div className="h-px w-full bg-line" />;
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[12px] leading-relaxed text-fg-3">
      {children}
    </div>
  );
}
