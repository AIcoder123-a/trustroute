'use client';

import type { ReactNode } from 'react';

import type { GuardData, InspectData, PolicyThresholds, ProtectData, StageResult } from '@/lib/types';
import { STAGE_STATUS_LABELS } from '@/lib/types';
import { ms, pct } from '@/lib/format';
import { isHighSensitivity } from '@/lib/redact';
import { stageBadge, thresholdCaption } from '@/lib/copy';
import { AlertIcon, ChevronRightIcon, LockIcon, ScanIcon, CodeIcon } from '@/components/icons';
import { ProbabilityMeter, StatusDot } from '@/components/ui';

/**
 * One detection, one row.
 *
 * A completed stage shows its conclusion in the row and puts every number one
 * click away. A failed stage opens by itself in effect: the consequence is
 * stated in the row, because "we could not check" must never look like a
 * quiet success.
 */
function StageRow({
  title,
  endpoint,
  icon,
  stage,
  metric,
  aside,
  children,
}: {
  title: string;
  endpoint: string;
  icon: ReactNode;
  stage: StageResult<unknown>;
  metric: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  // `skipped` is not a failure: nothing was expected to run. It still opens to
  // its own explanation, but it must not borrow the failure language.
  const skipped = stage.status === 'skipped';
  const failed = stage.status !== 'ok' && !skipped;

  const head = (
    <>
      <StatusDot status={stage.status} />
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-fg-3" aria-hidden="true">
          {icon}
        </span>
        <span className="truncate text-[13px] font-medium text-fg">{title}</span>
        <span className="mono hidden shrink-0 text-[10.5px] text-fg-3 md:inline">{endpoint}</span>
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-2">
        {aside}
        <span className="text-[12px] text-fg-2">{metric}</span>
        {skipped ? null : (
          <>
            <span className="mono hidden text-[10.5px] text-fg-3 sm:inline">{ms(stage.latencyMs)}</span>
            <span
              className={`hidden rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.06em] sm:inline ${
                stage.mode === 'live'
                  ? 'border-pass-line bg-pass-soft text-pass'
                  : 'border-review-line bg-review-soft text-review'
              }`}
              title={stage.mode === 'live' ? 'Response from the Clocked API' : 'Produced locally — no API request'}
            >
              {stageBadge(stage.mode)}
            </span>
          </>
        )}
      </span>
    </>
  );

  // A failed stage cannot be collapsed: the consequence is the point of the
  // row, and a closed disclosure would leave only a red dot to explain it.
  if (failed) {
    return (
      <div>
        <div className="flex items-center gap-3 px-4 py-2.5">{head}</div>
        <div className="flex gap-2.5 border-t border-line bg-surface-2/60 px-4 py-3">
          <AlertIcon size={14} className="mt-0.5 shrink-0 text-block" />
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-fg">
              {STAGE_STATUS_LABELS[stage.status]}
              {stage.error?.code ? <span className="mono ml-1.5 text-[10.5px] text-fg-3">{stage.error.code}</span> : null}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-fg-2">{stage.error?.message ?? 'No result was returned.'}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">
              Policy consequence: this stage contributed nothing, so the run reports{' '}
              <span className="text-review">screening unavailable</span> and is held for manual review.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
        {head}
        <ChevronRightIcon
          size={13}
          className="chev shrink-0 text-fg-3 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-line px-4 py-3.5">{children}</div>
    </details>
  );
}

function VerdictChip({ verdict }: { verdict: string }) {
  const tone =
    verdict === 'injection' || verdict === 'malicious'
      ? 'border-block-line bg-block-soft text-block'
      : verdict === 'suspicious'
        ? 'border-review-line bg-review-soft text-review'
        : 'border-pass-line bg-pass-soft text-pass';
  return (
    <span className={`hidden rounded border px-1.5 py-[2px] text-[10.5px] font-medium sm:inline ${tone}`}>
      {verdict}
    </span>
  );
}

/** A pointer, not a second copy of the list. */
function EvidencePointer({ count, noun }: { count: number; noun: string }) {
  return (
    <p className="text-[11.5px] text-fg-3">
      <span className="mono text-fg-2">{count}</span> {count === 1 ? noun : `${noun}s`} — every one is listed under{' '}
      <a href="#evidence" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
        Evidence
      </a>
      .
    </p>
  );
}

export function GuardCard({
  stage,
  thresholds,
}: {
  stage: StageResult<GuardData>;
  thresholds: PolicyThresholds;
}) {
  const data = stage.data;

  return (
    <StageRow
      title="Guard · prompt injection"
      endpoint="POST /injection"
      icon={<ScanIcon size={13} />}
      stage={stage}
      aside={data ? <VerdictChip verdict={data.verdict} /> : undefined}
      metric={stage.status === 'skipped' ? 'not requested' : data ? pct(data.injection) : '—'}
    >
      {!data ? (
        <p className="text-[12px] text-fg-3">No Guard result.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[24px] font-semibold leading-none tracking-tight text-fg">{pct(data.injection)}</span>
            <span className="text-[12px] text-fg-3">
              {data.severity ? `severity ${data.severity}` : 'no severity returned'}
              {data.category ? ` · ${data.category}` : ''}
            </span>
          </div>

          <div className="space-y-1.5">
            <ProbabilityMeter
              value={data.injection}
              threshold={data.threshold}
              blockAt={thresholds.blockInjectionProbability}
              tone={data.injection >= data.threshold ? 'block' : 'review'}
              thresholdLabel={thresholdCaption(stage.mode)}
            />
            <div className="flex justify-between text-[10.5px] text-fg-3">
              <span>
                {thresholdCaption(stage.mode)} {pct(data.threshold, 0)}
              </span>
              <span>policy block {pct(thresholds.blockInjectionProbability, 0)}</span>
            </div>
          </div>

          {data.evidence.length > 0 ? (
            <EvidencePointer count={data.evidence.length} noun="passage" />
          ) : (
            <p className="text-[11.5px] leading-relaxed text-fg-3">
              No evidence passage was returned — which is not proof of safety. Guard is a detector, not an enforcement
              boundary.
            </p>
          )}
        </div>
      )}
    </StageRow>
  );
}

export function ProtectCard({
  stage,
  reveal,
  onToggleReveal,
}: {
  stage: StageResult<ProtectData>;
  reveal: boolean;
  onToggleReveal: () => void;
}) {
  const data = stage.data;
  const counts = data ? Object.entries(data.counts).sort((a, b) => b[1] - a[1]) : [];
  const total = data?.entities.length ?? 0;

  return (
    <StageRow
      title="Protect · personal data"
      endpoint="POST /pii"
      icon={<LockIcon size={13} />}
      stage={stage}
      metric={stage.status === 'skipped' ? 'not requested' : data ? total === 0 ? 'none found' : `${total} ${total === 1 ? 'entity' : 'entities'}` : '—'}
    >
      {!data ? (
        <p className="text-[12px] text-fg-3">No Protect result.</p>
      ) : total === 0 ? (
        <p className="text-[12px] leading-relaxed text-fg-2">
          No personal data was found in this content. Protect can still miss data — masking applies to the findings
          returned, not to every possible sensitive fact.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {counts.map(([kind, count]) => (
              <span
                key={kind}
                className={`tag ${isHighSensitivity(kind) ? 'border-review-line bg-review-soft text-review' : ''}`}
              >
                <span className="mono text-[11px]">{kind}</span>
                <span className="text-[10.5px] opacity-70">×{count}</span>
              </span>
            ))}
            <button
              type="button"
              onClick={onToggleReveal}
              className="btn btn-ghost btn-sm ml-auto"
              aria-pressed={reveal}
            >
              {reveal ? 'Hide values' : 'Show values'}
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="bg-surface-2 text-[10px] uppercase tracking-[0.06em] text-fg-3">
                  <th className="w-[30%] px-2.5 py-1.5 font-semibold">Kind</th>
                  <th className="px-2.5 py-1.5 font-semibold">Matched value</th>
                  <th className="w-[22%] px-2.5 py-1.5 font-semibold">Offsets</th>
                </tr>
              </thead>
              <tbody>
                {data.entities.slice(0, 10).map((entity, index) => (
                  <tr key={`${entity.start}-${index}`} className="border-t border-line align-top">
                    <td className="px-2.5 py-1.5">
                      <span className={`mono text-[11px] ${isHighSensitivity(entity.type) ? 'text-review' : 'text-accent'}`}>
                        {entity.type}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <span className="mono break-all text-[11.5px] text-fg">
                        {reveal ? entity.value : '•'.repeat(Math.min(18, Math.max(4, entity.value.length)))}
                      </span>
                    </td>
                    <td className="mono px-2.5 py-1.5 text-[10.5px] text-fg-3">
                      {entity.start}–{entity.end}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total > 10 ? (
              <div className="border-t border-line bg-surface-2 px-2.5 py-1.5 text-[10.5px] text-fg-3">
                Showing 10 of {total} findings.
              </div>
            ) : null}
          </div>
        </div>
      )}
    </StageRow>
  );
}

export function InspectCard({
  stage,
  thresholds,
}: {
  stage: StageResult<InspectData>;
  thresholds: PolicyThresholds;
  sourceText: string;
}) {
  const data = stage.data;

  return (
    <StageRow
      title="Inspect · script behaviour"
      endpoint="POST /script"
      icon={<CodeIcon size={13} />}
      stage={stage}
      aside={data ? <VerdictChip verdict={data.verdict} /> : undefined}
      metric={stage.status === 'skipped' ? 'not requested' : data ? pct(data.malicious) : '—'}
    >
      {!data ? (
        <p className="text-[12px] leading-relaxed text-fg-3">
          Inspect runs only for the “Script / command” content type. Nothing is executed — this is static analysis.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-[24px] font-semibold leading-none tracking-tight text-fg">{pct(data.malicious)}</span>
            <span className="text-[12px] text-fg-3">
              malicious · {pct(data.suspicious)} suspicious
              {data.category ? ` · ${data.category}` : ''}
            </span>
          </div>

          <div className="space-y-1.5">
            <ProbabilityMeter
              value={data.malicious ?? 0}
              threshold={data.threshold}
              blockAt={thresholds.blockScriptMaliciousProbability}
              tone={(data.malicious ?? 0) >= data.threshold ? 'block' : 'review'}
              thresholdLabel={thresholdCaption(stage.mode)}
            />
            <div className="flex justify-between text-[10.5px] text-fg-3">
              <span>
                {thresholdCaption(stage.mode)} {pct(data.threshold, 0)}
              </span>
              <span>policy block {pct(thresholds.blockScriptMaliciousProbability, 0)}</span>
            </div>
          </div>

          {data.evidence.length > 0 ? (
            <EvidencePointer count={data.evidence.length} noun="flagged line" />
          ) : (
            <p className="text-[11.5px] text-fg-3">No specific lines were flagged.</p>
          )}

          <p className="text-[11px] text-fg-3">Static assessment only. A benign verdict is not an execution authorization.</p>
        </div>
      )}
    </StageRow>
  );
}
