'use client';

import { useState } from 'react';

import type { AnalyzeResponse, PolicyCheckOutcome, ReviewEvent } from '@/lib/types';
import { MIN_REJECT_NOTE, REVIEW_NOTE_MAX } from '@/lib/review';
import { clockTime, ms, pct } from '@/lib/format';
import { DECISION_STYLE, DecisionBadge, Divider } from '@/components/ui';
import { AlertIcon, CheckIcon, ClockIcon, DownloadIcon, InfoIcon, PrintIcon, RefreshIcon, ShieldIcon, XIcon } from '@/components/icons';

const REASON_TONE: Record<'block' | 'review' | 'info', string> = {
  block: 'text-block',
  review: 'text-review',
  info: 'text-fg-3',
};

const DOT: Record<'block' | 'review' | 'info', string> = {
  block: 'bg-block',
  review: 'bg-review',
  info: 'bg-fg-3/60',
};

const CHECK_TONE: Record<PolicyCheckOutcome, string> = {
  block: 'text-block',
  review: 'text-review',
  pass: 'text-pass',
  skipped: 'text-fg-3',
  failed: 'text-block',
};

const CHECK_DOT: Record<PolicyCheckOutcome, string> = {
  block: 'bg-block',
  review: 'bg-review',
  pass: 'bg-pass',
  skipped: 'bg-fg-3/40',
  failed: 'bg-block',
};

function IdleExplanation() {
  return (
    <div className="panel overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <ShieldIcon size={15} className="text-accent" />
        <h2 className="text-[13px] font-semibold tracking-tight">How the decision is made</h2>
      </header>
      <div className="space-y-3.5 px-3.5 py-3.5">
        <p className="text-[12.5px] leading-relaxed text-fg-2">
          Three detections run in parallel. A deterministic, server-side policy engine then turns their evidence into
          one of three outcomes. The model never decides on its own.
        </p>

        <div className="space-y-2.5">
          {[
            {
              decision: 'PASS' as const,
              text: 'Every required detection completed, no injection above the block line, and any personal data was masked.',
            },
            {
              decision: 'REVIEW' as const,
              text: 'Ambiguous signal, high-sensitivity personal data, or a detection that did not complete. A human decides.',
            },
            {
              decision: 'BLOCK' as const,
              text: 'Injection or malicious-script probability above the block line. The content never reaches the agent.',
            },
          ].map((item) => (
            <div key={item.decision} className="flex gap-2.5">
              <DecisionBadge decision={item.decision} />
              <p className="pt-1 text-[11.5px] leading-relaxed text-fg-2">{item.text}</p>
            </div>
          ))}
        </div>

        <Divider />

        <div className="rounded-lg border border-line bg-panel-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <InfoIcon size={12} className="text-fg-3" />
            <span className="text-[11px] font-medium text-fg-2">Failure is never a pass</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-3">
            A timeout, an authorization error, an exhausted credit balance or a malformed response degrades the run to
            REVIEW. TrustRoute never treats “we could not check” as “nothing was found”.
          </p>
        </div>
      </div>
    </div>
  );
}

export function DecisionPanel({
  result,
  review,
  busy,
  onApprove,
  onReject,
  onRecheck,
  onExport,
  onPrint,
}: {
  result: AnalyzeResponse | null;
  review: ReviewEvent | null;
  busy: boolean;
  onApprove: (note: string) => void;
  onReject: (note: string) => void;
  onRecheck: () => void;
  onExport: () => void;
  onPrint: () => void;
}) {
  const [note, setNote] = useState('');

  if (!result) return <IdleExplanation />;

  const { policy } = result;
  const style = DECISION_STYLE[policy.decision];
  const effectiveDecision = review?.decisionAfter ?? policy.decision;
  const overridden = review !== null && review.decisionAfter !== policy.decision;
  const trimmedNote = note.trim();
  const noteIsEnough = trimmedNote.length >= MIN_REJECT_NOTE;

  return (
    <div className="panel overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight">Decision</h2>
          <span className="mono text-[10px] text-fg-3">{result.runId.slice(4, 15)}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-[10.5px] text-fg-3">
          <ClockIcon size={11} />
          {ms(result.durationMs)}
        </span>
      </header>

      <div
        className={`px-3.5 py-3.5 ${style.bg}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`Screening decision: ${effectiveDecision}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span data-testid="decision-badge">
            <DecisionBadge decision={effectiveDecision} large />
          </span>
          {overridden ? (
            <span className="text-[10.5px] font-medium text-fg-2">
              reviewer override · policy said {policy.decision}
            </span>
          ) : (
            <span className="text-[10.5px] text-fg-3">server policy</span>
          )}
        </div>
        <p className={`mt-2.5 text-[13px] font-medium leading-snug ${style.text}`}>{policy.headline}</p>
      </div>

      <div className="space-y-3 px-3.5 py-3">
        {policy.degraded ? (
          <div className="flex gap-2 rounded-md border border-[#6b5320] bg-[#221a0d] px-2.5 py-2">
            <AlertIcon size={13} className="mt-0.5 shrink-0 text-review" />
            <p className="text-[11.5px] leading-relaxed text-[#f0c48a]">
              Screening was incomplete. This decision exists because a detection failed — not because anything was
              found safe.
            </p>
          </div>
        ) : null}

        <div>
          <div className="label mb-1.5">Why · {policy.reasons.length} findings</div>
          <ul className="space-y-2">
            {policy.reasons.map((reason) => (
              <li key={reason.code} className="flex gap-2">
                <span className={`mt-[6px] size-1.5 shrink-0 rounded-full ${DOT[reason.severity]}`} aria-hidden="true" />
                <div className="min-w-0">
                  <div className={`text-[12px] font-medium leading-snug ${REASON_TONE[reason.severity]}`}>
                    {reason.label}
                    <span className="mono ml-1.5 text-[9.5px] font-normal uppercase tracking-wider text-fg-3">
                      {reason.source}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-2">{reason.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <Divider />

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-fg-2">
            <span className="inline-block text-[9px] text-fg-3 transition-transform group-open:rotate-90" aria-hidden="true">
              ▶
            </span>
            Rule trace
            <span className="mono ml-auto text-[10px] font-normal text-fg-3">{policy.checks.length} checks</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {policy.checks.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <span
                  className={`mt-[5px] size-1.5 shrink-0 rounded-full ${CHECK_DOT[item.outcome]}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className={`text-[11px] leading-snug ${CHECK_TONE[item.outcome]}`}>{item.label}</div>
                  <div className="mono mt-px text-[10px] leading-snug text-fg-3">
                    {item.observed} · {item.threshold}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-fg-3">
            Every comparison the engine made, in evaluation order. A block anywhere wins; an unmet review line sends the
            content to a human. The same inputs always produce the same trace.
          </p>
        </details>

        <Divider />

        <div>
          <div className="label mb-1.5">What to do next</div>
          <ol className="space-y-1">
            {policy.actions.map((action, index) => (
              <li key={action} className="flex gap-2 text-[11.5px] leading-relaxed text-fg-2">
                <span className="mono pt-[1px] text-[10px] text-fg-3">{index + 1}</span>
                <span>{action}</span>
              </li>
            ))}
          </ol>
        </div>

        <Divider />

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <div>
            <dt className="label">Guard</dt>
            <dd className="mono text-[11.5px] text-fg">
              {pct(result.stages.guard.data?.injection ?? null)}
            </dd>
          </div>
          <div>
            <dt className="label">Inspect</dt>
            <dd className="mono text-[11.5px] text-fg">
              {result.stages.inspect.status === 'skipped' ? 'n/a' : pct(result.stages.inspect.data?.malicious ?? null)}
            </dd>
          </div>
          <div>
            <dt className="label">Entities masked</dt>
            <dd className="mono text-[11.5px] text-fg">{result.redaction.applied.length}</dd>
          </div>
          <div>
            <dt className="label">Credits</dt>
            <dd className="mono text-[11.5px] text-fg">
              {result.credits.reported ? result.credits.total : result.mode === 'mock' ? 'n/a · simulated' : 'not reported'}
            </dd>
          </div>
        </dl>

        <Divider />

        <div>
          <div className="label mb-1.5">Human checkpoint</div>
          {review ? (
            <div className="rounded-md border border-line bg-panel-2 px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg">
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
              {review.note ? <p className="mt-1 text-[11px] leading-relaxed text-fg-2">{review.note}</p> : null}
              <p className="mt-1 text-[10.5px] leading-relaxed text-fg-3">
                Internal state only. Nothing outside TrustRoute was approved, executed or sent.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block">
                <span className="label">
                  Reviewer note <span className="normal-case tracking-normal text-fg-3">· required to reject</span>
                </span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  maxLength={REVIEW_NOTE_MAX}
                  aria-label="Reviewer note"
                  placeholder="Why this decision — one sentence is enough."
                  className="scroll-thin mt-1 block w-full resize-none rounded-md border border-line bg-panel-2 px-2 py-1.5 text-[11.5px] leading-relaxed text-fg outline-none placeholder:text-fg-3 focus:border-accent/60"
                />
              </label>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn h-8 flex-1 px-2.5 text-[11.5px]"
                  onClick={() => {
                    onApprove(trimmedNote);
                    setNote('');
                  }}
                  disabled={busy || policy.decision === 'PASS'}
                  title={policy.decision === 'PASS' ? 'Nothing to approve: policy already passed this content.' : undefined}
                >
                  <CheckIcon size={13} className="text-pass" />
                  Approve
                </button>
                <button
                  type="button"
                  className="btn h-8 flex-1 px-2.5 text-[11.5px]"
                  onClick={() => {
                    onReject(trimmedNote);
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
                <button type="button" className="btn h-8 px-2.5 text-[11.5px]" onClick={onRecheck} disabled={busy}>
                  <RefreshIcon size={13} />
                  Recheck
                </button>
              </div>

              <div className="flex items-center justify-between text-[10px] text-fg-3">
                <span>
                  {noteIsEnough ? 'Ready to record.' : `${Math.max(0, MIN_REJECT_NOTE - trimmedNote.length)} more characters to reject`}
                </span>
                <span className="mono">
                  {trimmedNote.length}/{REVIEW_NOTE_MAX}
                </span>
              </div>
            </div>
          )}
          <p className="mt-2 text-[10.5px] leading-relaxed text-fg-3">
            Approval changes TrustRoute&apos;s internal routing state only. It does not execute the script, send the
            message or act on the content.
          </p>
        </div>

        <Divider />

        <div className="flex gap-1.5">
          <button type="button" className="btn h-8 flex-1 px-2.5 text-[11.5px]" onClick={onExport}>
            <DownloadIcon size={13} />
            JSON report
          </button>
          <button type="button" className="btn h-8 flex-1 px-2.5 text-[11.5px]" onClick={onPrint}>
            <PrintIcon size={13} />
            Review sheet
          </button>
        </div>
      </div>
    </div>
  );
}
