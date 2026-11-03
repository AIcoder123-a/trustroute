import type { Decision, StageStatus } from '@/lib/types';

import { pct } from '@/lib/format';

/**
 * Decision colour is the only place a saturated colour is allowed to carry
 * meaning: teal for pass, amber for a human decision, red for a block.
 */
export const DECISION_STYLE: Record<
  Decision,
  { text: string; bg: string; border: string; dot: string; soft: string }
> = {
  PASS: {
    text: 'text-pass',
    bg: 'bg-pass-soft',
    border: 'border-pass-line',
    dot: 'bg-pass',
    soft: 'text-pass',
  },
  REVIEW: {
    text: 'text-review',
    bg: 'bg-review-soft',
    border: 'border-review-line',
    dot: 'bg-review',
    soft: 'text-review',
  },
  BLOCK: {
    text: 'text-block',
    bg: 'bg-block-soft',
    border: 'border-block-line',
    dot: 'bg-block',
    soft: 'text-block',
  },
};

export function DecisionBadge({ decision, large = false }: { decision: Decision; large?: boolean }) {
  const style = DECISION_STYLE[decision];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border font-semibold tracking-tight ${style.bg} ${style.border} ${style.text} ${
        large ? 'h-9 px-3 text-[15px]' : 'h-6 px-2 text-[11.5px]'
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
      className={`inline-flex items-center gap-2 rounded-lg border border-review-line bg-review-soft font-semibold tracking-tight text-review ${
        large ? 'h-9 px-3 text-[15px]' : 'h-6 px-2 text-[11px] uppercase tracking-[0.05em]'
      }`}
    >
      <span className={`${large ? 'size-2' : 'size-1.5'} rounded-full bg-review`} />
      Unavailable
    </span>
  );
}

export function StatusDot({ status }: { status: StageStatus }) {
  const color =
    status === 'ok'
      ? 'bg-pass'
      : status === 'skipped'
        ? 'bg-line-strong'
        : status === 'timeout' || status === 'quota'
          ? 'bg-review'
          : 'bg-block';
  return <span className={`inline-block size-1.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
}

/**
 * A probability bar with the detector line and the policy block line marked,
 * so a number can be read as a comparison rather than a verdict.
 */
export function ProbabilityMeter({
  value,
  threshold,
  blockAt,
  tone,
  thresholdLabel = 'reference line',
  onDark = false,
}: {
  value: number;
  threshold: number;
  blockAt: number;
  tone: 'block' | 'review';
  thresholdLabel?: string;
  onDark?: boolean;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      className={`relative h-[5px] w-full overflow-hidden rounded-full ${onDark ? 'bg-code-2' : 'bg-surface-3'}`}
      role="presentation"
    >
      <div
        className={`h-full rounded-full ${tone === 'block' ? 'bg-block' : 'bg-review'}`}
        style={{ width: `${clamped * 100}%` }}
      />
      <div
        className={`absolute top-0 h-full w-px ${onDark ? 'bg-code-fg/45' : 'bg-fg/35'}`}
        style={{ left: `${threshold * 100}%` }}
        title={`${thresholdLabel} ${pct(threshold)}`}
      />
      <div
        className={`absolute top-0 h-full w-px ${onDark ? 'bg-code-fg/25' : 'bg-fg/20'}`}
        style={{ left: `${blockAt * 100}%` }}
        title={`Policy block line ${pct(blockAt)}`}
      />
    </div>
  );
}
