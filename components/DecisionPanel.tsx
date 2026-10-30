'use client';

import type { AnalyzeResponse, ReviewEvent } from '@/lib/types';
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
  onApprove: () => void;
  onReject: () => void;
  onRecheck: () => void;
  onExport: () => void;
  onPrint: () => void;
}) {
  if (!result) return <IdleExplanation />;

  const { policy } = result;
  const style = DECISION_STYLE[policy.decision];
  const effectiveDecision = review?.decisionAfter ?? policy.decision;
  const overridden = review !== null && review.decisionAfter !== policy.decision;

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
              {result.credits.reported ? result.credits.total : result.mode === 'mock' ? 'n/a · mock' : 'not reported'}
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
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="btn h-8 flex-1 px-2.5 text-[11.5px]"
                onClick={onApprove}
                disabled={busy || policy.decision === 'PASS'}
                title={policy.decision === 'PASS' ? 'Nothing to approve: policy already passed this content.' : undefined}
              >
                <CheckIcon size={13} className="text-pass" />
                Approve
              </button>
              <button
                type="button"
                className="btn h-8 flex-1 px-2.5 text-[11.5px]"
                onClick={onReject}
                disabled={busy || policy.decision === 'BLOCK'}
                title={policy.decision === 'BLOCK' ? 'Already blocked by policy.' : undefined}
              >
                <XIcon size={13} className="text-block" />
                Reject
              </button>
              <button type="button" className="btn h-8 px-2.5 text-[11.5px]" onClick={onRecheck} disabled={busy}>
                <RefreshIcon size={13} />
                Recheck
              </button>
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
