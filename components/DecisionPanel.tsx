'use client';

import { useState } from 'react';

import type { AnalyzeResponse, Decision, PolicyCheckOutcome, ReviewEvent } from '@/lib/types';
import { MIN_REJECT_NOTE, REVIEW_NOTE_MAX } from '@/lib/review';
import { clockTime, ms, pct } from '@/lib/format';
import { creditsValue, runOriginLabel } from '@/lib/copy';
import { DECISION_STYLE, DecisionBadge, UnavailableBadge } from '@/components/ui';
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  DownloadIcon,
  InfoIcon,
  PrintIcon,
  RefreshIcon,
  XIcon,
} from '@/components/icons';

const CHECK_TONE: Record<PolicyCheckOutcome, string> = {
  block: 'text-block',
  review: 'text-review',
  pass: 'text-pass',
  skipped: 'text-fg-3',
  failed: 'text-block',
};

const DOT: Record<'block' | 'review' | 'info', string> = {
  block: 'bg-block',
  review: 'bg-review',
  info: 'bg-fg-3/60',
};

const TONE_TEXT: Record<'block' | 'review' | 'info', string> = {
  block: 'text-block',
  review: 'text-review',
  info: 'text-fg-3',
};

const DECISION_EDGE: Record<Decision, string> = {
  PASS: 'border-l-pass',
  REVIEW: 'border-l-review',
  BLOCK: 'border-l-block',
};

/**
 * The answer, before the evidence.
 *
 * Everything a reader needs in the first three seconds — the decision, why in
 * one sentence, and four numbers — sits here. On a phone this block is sticky,
 * so the verdict never scrolls out of sight while the passages are read.
 */
export function ResultSummary({
  result,
  review,
  busy,
  onEdit,
  onRecheck,
  onExport,
  onPrint,
}: {
  result: AnalyzeResponse;
  review: ReviewEvent | null;
  busy: boolean;
  onEdit: () => void;
  onRecheck: () => void;
  onExport: () => void;
  onPrint: () => void;
}) {
  const { policy } = result;
  const style = DECISION_STYLE[review?.decisionAfter ?? policy.decision];
  const effective: Decision = review?.decisionAfter ?? policy.decision;
  const overridden = review !== null && review.decisionAfter !== policy.decision;
  const unavailable = policy.screening === 'unavailable' && !overridden;
  const headline = overridden
    ? review.action === 'approve'
      ? 'Approved by a reviewer. The masked copy may now be forwarded; nothing was executed.'
      : 'Rejected by a reviewer. The content stays inside TrustRoute.'
    : policy.headline;

  const edge = unavailable ? 'border-l-review' : overridden ? 'border-l-accent' : DECISION_EDGE[policy.decision];

  return (
    <section aria-label="Screening result" className={`card overflow-hidden border-l-[3px] ${edge}`}>
      <div
        className={`px-4 py-3 sm:px-5 ${unavailable ? style.bg : style.bg}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`Screening decision: ${unavailable ? 'screening unavailable, manual review required' : effective}`}
        data-screening={policy.screening}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span data-testid="decision-badge">
            {unavailable ? <UnavailableBadge large /> : <DecisionBadge decision={effective} large />}
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <a href="#decision" className="btn btn-ghost btn-sm lg:hidden">
              Why
              <ArrowRightIcon size={11} />
            </a>
            <button type="button" className="btn btn-ghost btn-sm hidden sm:inline-flex" onClick={onEdit}>
              Edit input
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={onRecheck}
              disabled={busy}
              aria-label="Screen again"
            >
              <RefreshIcon size={12} />
              <span className="hidden sm:inline">Screen again</span>
              <span className="sm:hidden">Again</span>
            </button>
          </div>
        </div>

        <p
          className={`mt-2 text-[13.5px] font-medium leading-snug sm:text-[15px] ${
            unavailable ? 'text-[#7d4c10]' : style.text
          }`}
        >
          {headline}
        </p>

        {overridden ? (
          <p className="mt-1.5 text-[11px] text-fg-2">
            reviewer override · policy said {policy.decision}
          </p>
        ) : unavailable ? (
          <p className="mt-1.5 text-[11px] text-review">no risk verdict · held for a human</p>
        ) : null}
      </div>

      <dl className="hidden flex-wrap items-start gap-x-6 gap-y-3 border-t border-line bg-surface px-5 py-3 sm:flex">
        <Stat label="Injection" value={pct(result.stages.guard.data?.injection ?? null)} />
        <Stat
          label="Script risk"
          value={result.stages.inspect.status === 'skipped' ? 'n/a' : pct(result.stages.inspect.data?.malicious ?? null)}
        />
        <Stat label="Masked" value={String(result.redaction.applied.length)} />
        <Stat label="Latency" value={ms(result.durationMs)} />
        <Stat label="Credits" value={creditsValue(result.mode, result.credits.total, result.credits.reported)} />
      </dl>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-4 py-2 sm:px-5">
        <span
          className={`rounded border px-1.5 py-px text-[10.5px] font-medium ${
            result.mode === 'mock'
              ? 'border-review-line bg-review-soft text-review'
              : 'border-pass-line bg-pass-soft text-pass'
          }`}
        >
          {runOriginLabel(result.mode)}
        </span>
        <span className="mono hidden text-[10.5px] text-fg-3 sm:inline">{result.runId.slice(4, 15)}</span>
        <span className="hidden text-[10.5px] text-fg-3 sm:inline">·</span>
        <span className="mono text-[10.5px] text-fg-3">{result.input.characters.toLocaleString()} chars</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onExport}>
            <DownloadIcon size={12} />
            JSON report
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onPrint}>
            <PrintIcon size={12} />
            Review sheet
          </button>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[74px]">
      <dt className="label">{label}</dt>
      <dd className={`mono mt-1 text-[12.5px] ${tone ?? 'text-fg'}`}>{value}</dd>
    </div>
  );
}

/**
 * The reasoning column: why, what next, and the human checkpoint.
 *
 * This is the only place the decision is explained; the stage rows below show
 * measurements, not a second verdict.
 */
export function InsightRail({
  result,
  review,
  busy,
  onApprove,
  onReject,
}: {
  result: AnalyzeResponse;
  review: ReviewEvent | null;
  busy: boolean;
  onApprove: (note: string) => void;
  onReject: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const { policy } = result;
  const effective: Decision = review?.decisionAfter ?? policy.decision;
  const trimmed = note.trim();
  const noteIsEnough = trimmed.length >= MIN_REJECT_NOTE;
  const needsHuman = effective === 'REVIEW' && review === null;
  const blockingChecks = policy.checks.filter((item) => item.outcome === 'block' || item.outcome === 'failed').length;

  return (
    <div className="space-y-3">
      <section id="decision" className="card scroll-mt-32 overflow-hidden" aria-label="Why this decision">
        <header className="flex items-center gap-2 px-4 py-2.5">
          <h2 className="text-[13px] font-semibold tracking-tight text-fg">Why</h2>
          <span className="mono text-[10.5px] text-fg-3">
            {policy.reasons.length} finding{policy.reasons.length === 1 ? '' : 's'}
          </span>
        </header>

        <div className="border-t border-line px-4 py-3">
          {policy.degraded ? (
            <div className="mb-3 flex gap-2 rounded-md border border-review-line bg-review-soft px-2.5 py-2">
              <AlertIcon size={13} className="mt-0.5 shrink-0 text-review" />
              <p className="text-[11.5px] leading-relaxed text-review">
                A required detection returned no result, so nothing was assessed on that dimension. The content is
                unscreened — not cleared.
              </p>
            </div>
          ) : null}

          <ul className="space-y-2.5">
            {policy.reasons.map((reason) => (
              <li key={reason.code} className="flex gap-2">
                <span className={`mt-[6px] size-1.5 shrink-0 rounded-full ${DOT[reason.severity]}`} aria-hidden="true" />
                <div className="min-w-0">
                  <div className={`text-[12.5px] font-medium leading-snug ${TONE_TEXT[reason.severity]}`}>
                    {reason.label}
                    <span className="mono ml-1.5 text-[9px] font-normal uppercase tracking-wider text-fg-3">
                      {reason.source}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-2">{reason.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2 text-[11.5px] font-medium text-fg-2 hover:text-fg">
            <span className="text-[9px] text-fg-3 transition-transform group-open:rotate-90" aria-hidden="true">
              ▶
            </span>
            Rule trace
            <span className="mono ml-auto text-[10px] font-normal text-fg-3">
              {policy.checks.length} checks{blockingChecks > 0 ? ` · ${blockingChecks} blocking` : ''}
            </span>
          </summary>
          <ul className="space-y-1.5 px-4 pb-3 pt-1">
            {policy.checks.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <span className={`mt-[5px] size-1.5 shrink-0 rounded-full ${CHECK_TONE[item.outcome]}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className={`text-[11px] leading-snug ${CHECK_TONE[item.outcome]}`}>{item.label}</div>
                  <div className="mono mt-px text-[10px] leading-snug text-fg-3">
                    {item.observed} · {item.threshold}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-3 text-[10.5px] leading-relaxed text-fg-3">
            Every comparison the engine made, in evaluation order. A block anywhere wins. The same inputs always produce
            the same trace.
          </p>
        </details>
      </section>

      <section className="card px-4 py-3" aria-label="What to do next">
        <h2 className="label mb-2">What to do next</h2>
        <ol className="space-y-1.5">
          {policy.actions.map((action, index) => (
            <li key={action} className="flex gap-2.5 text-[12px] leading-relaxed text-fg-2">
              <span className="mono mt-px shrink-0 text-[10.5px] text-fg-3">{index + 1}</span>
              <span>{action}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="checkpoint" className="card scroll-mt-32 px-4 py-3" aria-label="Human checkpoint">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="label">Human checkpoint</h2>
          {needsHuman ? <span className="text-[10.5px] font-medium text-review">a person must decide</span> : null}
        </div>

        {review ? (
          <div className="rounded-lg bg-surface-2 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-fg">
              {review.action === 'approve' ? (
                <CheckIcon size={12} className="text-pass" />
              ) : review.action === 'reject' ? (
                <XIcon size={12} className="text-block" />
              ) : (
                <RefreshIcon size={12} className="text-fg-2" />
              )}
              <span className="capitalize">{review.action}</span>
              <span className="text-fg-3">by {review.actor}</span>
              <span className="mono ml-auto text-[10px] text-fg-3">{clockTime(review.at)}</span>
            </div>
            {review.note ? <p className="mt-1 text-[11.5px] leading-relaxed text-fg-2">{review.note}</p> : null}
            <p className="mt-1 text-[10.5px] leading-relaxed text-fg-3">
              Internal state only. Nothing outside TrustRoute was approved, executed or sent.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-fg-3">
                Reviewer note <span className="text-fg-3/80">· required to reject</span>
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={REVIEW_NOTE_MAX}
                aria-label="Reviewer note"
                placeholder="Why this decision — one sentence is enough."
                className="scroll-thin block w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-2 text-[12px] leading-relaxed text-fg outline-none placeholder:text-fg-3 focus:border-accent"
              />
            </label>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={`btn btn-sm flex-1 ${needsHuman ? 'btn-primary' : ''}`}
                onClick={() => {
                  onApprove(trimmed);
                  setNote('');
                }}
                disabled={busy || policy.decision === 'PASS'}
                title={policy.decision === 'PASS' ? 'Nothing to approve: policy already passed this content.' : undefined}
              >
                <CheckIcon size={13} className={needsHuman ? '' : 'text-pass'} />
                Approve
              </button>
              <button
                type="button"
                className="btn btn-sm flex-1"
                onClick={() => {
                  onReject(trimmed);
                  setNote('');
                }}
                disabled={busy || policy.decision === 'BLOCK' || !noteIsEnough}
                title={
                  policy.decision === 'BLOCK'
                    ? 'Already blocked by policy.'
                    : noteIsEnough
                      ? undefined
                      : `Add at least ${MIN_REJECT_NOTE} characters of reasoning to reject.`
                }
              >
                <XIcon size={13} className="text-block" />
                Reject
              </button>
            </div>

            <div className="flex items-center justify-between text-[10.5px] text-fg-3">
              <span>
                {noteIsEnough ? 'Ready to record.' : `${Math.max(0, MIN_REJECT_NOTE - trimmed.length)} more characters to reject`}
              </span>
              <span className="mono">
                {trimmed.length}/{REVIEW_NOTE_MAX}
              </span>
            </div>
          </div>
        )}

        <p className="mt-2 text-[10.5px] leading-relaxed text-fg-3">
          Approval changes TrustRoute&apos;s internal routing state only. It does not execute the script, send the
          message or act on the content.
        </p>
      </section>
    </div>
  );
}

/** The idle rail: what the three outcomes mean, in four lines. */
export function DecisionPrimer() {
  return (
    <section className="card overflow-hidden" aria-label="How the decision is made">
      <header className="px-4 py-3">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">How the decision is made</h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">
          Three detections run in parallel; a deterministic rule engine, not the model, returns one outcome.
        </p>
      </header>
      <dl className="divide-y divide-line border-t border-line">
        {[
          { term: 'PASS', body: 'Nothing above a block line, and any personal data was masked.', tone: 'pass' },
          { term: 'REVIEW', body: 'Ambiguous signal, or high-sensitivity data. A human decides.', tone: 'review' },
          { term: 'BLOCK', body: 'Injection or malicious script above the block line. Not forwarded.', tone: 'block' },
        ].map((row) => (
          <div key={row.term} className="flex items-start gap-2.5 px-4 py-2">
            <span
              className={`mono mt-[3px] w-[52px] shrink-0 text-[10.5px] font-semibold ${
                row.tone === 'pass' ? 'text-pass' : row.tone === 'review' ? 'text-review' : 'text-block'
              }`}
            >
              {row.term}
            </span>
            <dd className="text-[11.5px] leading-relaxed text-fg-2">{row.body}</dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-2 border-t border-line px-4 py-2.5">
        <InfoIcon size={12} className="mt-[3px] shrink-0 text-fg-3" />
        <p className="text-[11px] leading-relaxed text-fg-3">
          <span className="font-medium text-fg-2">Failure is never a pass.</span> A timeout, an authorization error or an
          exhausted balance degrades the run to manual review.
        </p>
      </div>
    </section>
  );
}
