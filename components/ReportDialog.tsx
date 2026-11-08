'use client';

import { useEffect, useRef } from 'react';

import type { ReviewReport } from '@/lib/report';
import { reportToJson } from '@/lib/report';
import { pct } from '@/lib/format';
import { DecisionBadge } from '@/components/ui';
import { DownloadIcon, PrintIcon, XIcon } from '@/components/icons';
import type { Decision } from '@/lib/types';

export function ReportDialog({
  report,
  onClose,
  onDownload,
}: {
  report: ReviewReport;
  onClose: () => void;
  onDownload: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const json = reportToJson(report);
  const policyDecision = report.decision.decision;
  const effective = report.review?.decisionAfter ?? report.decision.decision;
  /**
   * A blocked run stays blocked in the sheet even if a later state were somehow
   * different: the policy verdict is the fact the sheet is reporting, and a
   * sanitized copy under a block is a preview, never a forwarded message.
   */
  const blocked = policyDecision === 'BLOCK' || effective === 'BLOCK';

  return (
    <div
      className="report-overlay fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="report-sheet my-4 w-full max-w-3xl rounded-xl border border-line-strong bg-surface shadow-xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 print-hide">
          <div>
            <h2 id="report-title" className="text-[14px] font-semibold tracking-tight">
              Review sheet
            </h2>
            <p className="mt-0.5 text-[11px] text-fg-3">
              Printable summary. The JSON export carries the same record with full field names.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className="btn h-8 px-2.5 text-[11.5px]" onClick={() => window.print()}>
              <PrintIcon size={13} />
              Print
            </button>
            <button type="button" className="btn h-8 px-2.5 text-[11.5px]" onClick={onDownload}>
              <DownloadIcon size={13} />
              JSON
            </button>
            <button
              ref={closeRef}
              type="button"
              className="btn btn-ghost h-8 px-2"
              onClick={onClose}
              aria-label="Close review sheet"
            >
              <XIcon size={14} />
            </button>
          </div>
        </header>

        <div className="space-y-5 px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="label">TrustRoute · review report</div>
              <h3 className="mt-1 text-[19px] font-semibold tracking-tight">
                {report.subject.caseTitle ?? 'Pasted content'}
              </h3>
              <p className="mt-0.5 text-[11.5px] capitalize text-fg-2">
                {report.subject.contentType.replace(/_/g, ' ')}
              </p>
              <p className="mono mt-1 text-[11px] text-fg-3">
                {report.subject.runId} · screened {new Date(report.subject.screenedAt).toISOString()}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <DecisionBadge decision={effective as Decision} large />
              <div className="mt-1.5 text-[11px] text-fg-3">
                {effective === policyDecision
                  ? 'policy decision'
                  : `policy said ${policyDecision} · reviewer moved it to ${effective}`}
              </div>
              <div className="mt-1 text-[11px] text-fg-3">
                {report.generator.transport === 'live' ? 'Live Clocked API' : 'SIMULATED RESULTS — not Clocked output'}
              </div>
            </div>
          </div>

          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-2">
            {/* The policy headline describes the pre-review state; once a review
                exists the sheet must not claim the run is still held. */}
            {report.review
              ? report.review.action === 'approve'
                ? `Approved by a reviewer. Policy had held this run at ${policyDecision}; TrustRoute itself sent nothing.`
                : `Rejected by a reviewer. Policy said ${policyDecision}; the content stays blocked inside TrustRoute.`
              : report.decision.headline}
          </p>

          <section>
            <h4 className="label mb-1.5">Subject</h4>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] sm:grid-cols-4">
              <div>
                <dt className="text-fg-3">Characters</dt>
                <dd className="mono">{report.subject.characters.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-fg-3">Words</dt>
                <dd className="mono">{report.subject.words.toLocaleString()}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-fg-3">SHA-256</dt>
                <dd className="mono truncate" title={report.subject.textHashSha256Prefix}>
                  {report.subject.textHashSha256Prefix.slice(0, 16)}…
                </dd>
              </div>
              <div>
                <dt className="text-fg-3">Entities</dt>
                <dd className="mono">{report.protection.entitiesFound}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h4 className="label mb-1.5">Screening</h4>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full border-collapse text-left text-[11.5px]">
                <thead>
                  <tr className="bg-surface-2 text-[10px] uppercase tracking-[0.07em] text-fg-3">
                    <th className="px-2.5 py-1.5 font-semibold">Endpoint</th>
                    <th className="px-2.5 py-1.5 font-semibold">Status</th>
                    <th className="px-2.5 py-1.5 font-semibold">Verdict</th>
                    <th className="px-2.5 py-1.5 font-semibold">Probability</th>
                    <th className="px-2.5 py-1.5 font-semibold">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {report.screening.map((row) => (
                    <tr key={row.endpoint} className="border-t border-line">
                      <td className="mono px-2.5 py-1.5">{row.endpoint}</td>
                      <td className="px-2.5 py-1.5">{row.status}</td>
                      <td className="px-2.5 py-1.5">{row.verdict ?? '—'}</td>
                      <td className="mono px-2.5 py-1.5">{row.probability === null ? '—' : pct(row.probability)}</td>
                      <td className="mono px-2.5 py-1.5 text-fg-3">{row.latencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h4 className="label mb-1.5">Protection applied</h4>
            <p className="text-[11.5px] leading-relaxed text-fg-2">
              {report.protection.entitiesFound === 0
                ? 'No personal data was found, so nothing was masked.'
                : `${report.protection.entitiesFound} finding(s) across ${report.protection.kinds.join(
                    ', ',
                  )} were replaced ${
                    blocked ? 'in the sanitized preview' : 'before forwarding'
                  }. ${report.protection.spansDropped} overlapping and ${
                    report.protection.spansRejected
                  } unusable span(s) were reconciled.`}
            </p>
            {blocked ? (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-block">
                Blocked at the gateway. This copy is a preview for the reviewer — it was not forwarded, and nothing was
                sent.
              </p>
            ) : null}
            {report.protection.maskedText ? (
              <>
                <div className="label mt-2.5 mb-1">
                  {blocked ? 'Sanitized preview (blocked — not forwarded)' : 'Copy that would be forwarded'}
                </div>
                <pre className="report-code mono scroll-thin max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas px-3 py-2.5 text-[11.5px] leading-relaxed text-fg-2">
                  {report.protection.maskedText}
                </pre>
              </>
            ) : null}
          </section>

          <section>
            <h4 className="label mb-1.5">Policy reasons</h4>
            <ul className="space-y-1.5">
              {report.decision.reasons.map((reason) => (
                <li key={reason.code} className="text-[11.5px] leading-relaxed text-fg-2">
                  <span className="font-medium text-fg">{reason.label}.</span> {reason.detail}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className="label mb-1.5">Human review</h4>
            {report.review ? (
              <p className="text-[11.5px] leading-relaxed text-fg-2">
                <span className="font-medium capitalize text-fg">{report.review.action}</span> by {report.review.actor} at{' '}
                <span className="mono">{new Date(report.review.at).toISOString()}</span>. Decision moved from{' '}
                {report.review.decisionBefore} to {report.review.decisionAfter}.
                {report.review.note ? ` Note: “${report.review.note}”` : ''}
              </p>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-fg-3">No human review was recorded for this run.</p>
            )}
          </section>

          <section>
            <h4 className="label mb-1.5">Data sources</h4>
            <ul className="space-y-0.5 text-[11px] leading-relaxed text-fg-2">
              {report.dataSources.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className="label mb-1.5">Disclaimers</h4>
            <ul className="space-y-0.5 text-[11px] leading-relaxed text-fg-3">
              {report.disclaimers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <details className="rounded-lg border border-line">
            <summary className="cursor-pointer px-3 py-2 text-[11.5px] font-medium text-fg-2">
              Raw JSON ({json.length.toLocaleString()} characters)
            </summary>
            <pre className="report-code mono scroll-thin max-h-64 overflow-auto border-t border-line bg-canvas px-3 py-2.5 text-[11px] leading-relaxed text-fg-3">
              {json}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
