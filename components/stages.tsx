'use client';

import type { ReactNode } from 'react';

import type { GuardData, InspectData, PolicyThresholds, ProtectData, StageResult } from '@/lib/types';
import { STAGE_STATUS_LABELS } from '@/lib/types';
import { ms, pct } from '@/lib/format';
import { isHighSensitivity } from '@/lib/redact';
import { stageBadge, thresholdCaption } from '@/lib/copy';
import { AlertIcon, CodeIcon, LockIcon, ScanIcon } from '@/components/icons';
import { EmptyHint, ProbabilityMeter } from '@/components/ui';

function StageShell({
  title,
  endpoint,
  icon,
  stage,
  children,
  aside,
}: {
  title: string;
  endpoint: string;
  icon: ReactNode;
  stage: StageResult<unknown>;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <article className="panel overflow-hidden">
      <header className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-fg-2">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <h3 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h3>
            {/* On a 390px viewport the endpoint squeezes the title into three lines. */}
            <span className="mono hidden text-[10.5px] text-fg-3 sm:inline">{endpoint}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {aside}
          <span className="mono text-[10.5px] text-fg-3">{ms(stage.latencyMs)}</span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] ${
              stage.mode === 'live'
                ? 'border-[#1d5745] bg-[#0d2720] text-pass'
                : 'border-[#5a4a1c] bg-[#26200f] text-review'
            }`}
            title={stage.mode === 'live' ? 'Response from the Clocked API' : 'Produced locally — no API request'}
          >
            {stageBadge(stage.mode)}
          </span>
        </div>
      </header>

      {stage.status !== 'ok' ? (
        <div className="flex gap-2.5 border-t border-line px-3.5 py-3">
          <AlertIcon size={15} className="mt-0.5 shrink-0 text-block" />
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-fg">
              {STAGE_STATUS_LABELS[stage.status]}
              {stage.error?.code ? <span className="mono ml-1.5 text-[10.5px] text-fg-3">{stage.error.code}</span> : null}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-fg-2">{stage.error?.message ?? 'No result was returned.'}</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-3">
              Policy consequence: this stage contributed nothing, so the run reports{' '}
              <span className="text-[#f0c48a]">screening unavailable</span> and is held for manual review. No pass can
              come from a missing result.
            </p>
          </div>
        </div>
      ) : (
        <div className="border-t border-line px-3.5 py-3">{children}</div>
      )}
    </article>
  );
}

function VerdictChip({ verdict }: { verdict: string }) {
  const tone =
    verdict === 'injection' || verdict === 'malicious'
      ? 'border-[#6d2a30] bg-[#2c1216] text-block'
      : verdict === 'suspicious'
        ? 'border-[#6b5320] bg-[#2a2110] text-review'
        : 'border-[#1d5745] bg-[#0d2720] text-pass';
  return (
    <span className={`inline-flex items-center rounded border px-2 py-[3px] text-[11px] font-medium ${tone}`}>
      {verdict}
    </span>
  );
}

/** "3 passages — listed under Evidence" pointer, so the list lives in one place. */
function EvidencePointer({ count, noun }: { count: number; noun: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
      <span className="mono text-fg-2">{count}</span>
      {count === 1 ? noun : `${noun}s`} — every one is listed under{' '}
      <a href="#evidence" className="text-accent underline decoration-dotted underline-offset-2">
        Evidence
      </a>
      , where a click locates it in the source.
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
    <StageShell
      title="Guard · prompt injection"
      endpoint="POST /injection"
      icon={<ScanIcon size={14} />}
      stage={stage}
      aside={data ? <VerdictChip verdict={data.verdict} /> : undefined}
    >
      {!data ? (
        <EmptyHint>No Guard result.</EmptyHint>
      ) : (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div>
              <div className="label">Injection probability</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-[27px] font-semibold leading-none tracking-tight text-fg">
                  {pct(data.injection)}
                </span>
                <span className="text-[12px] text-fg-3">
                  {data.severity ? `severity ${data.severity}` : 'no severity returned'}
                </span>
              </div>
            </div>
            {data.category ? (
              <div className="max-w-[46%] text-right">
                <div className="label">Top category</div>
                <div className="mt-0.5 truncate text-[12px] text-fg-2" title={data.category}>
                  {data.category}
                </div>
              </div>
            ) : null}
          </div>

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

          {data.evidence.length > 0 ? (
            <EvidencePointer count={data.evidence.length} noun="passage" />
          ) : (
            <p className="text-[11.5px] leading-relaxed text-fg-3">
              No evidence passage was returned. That is not proof the content is safe — Guard is a detector, not an
              enforcement boundary.
            </p>
          )}
        </div>
      )}
    </StageShell>
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

  return (
    <StageShell
      title="Protect · personal data"
      endpoint="POST /pii"
      icon={<LockIcon size={14} />}
      stage={stage}
      aside={
        data ? (
          <span className="chip h-[22px] px-2 text-[10.5px]">
            {data.entities.length} {data.entities.length === 1 ? 'entity' : 'entities'}
          </span>
        ) : undefined
      }
    >
      {!data ? (
        <EmptyHint>No Protect result.</EmptyHint>
      ) : data.entities.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-fg-2">
          No personal data was found in this content. Protect can still miss data — masking applies to the findings
          returned, not to every possible sensitive fact.
        </p>
      ) : (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {counts.map(([kind, count]) => (
              <span
                key={kind}
                className={`chip h-[24px] ${
                  isHighSensitivity(kind) ? 'border-[#6b5320] bg-[#2a2110] text-[#f0c48a]' : ''
                }`}
              >
                <span className="mono text-[11px]">{kind}</span>
                <span className="text-[10.5px] text-fg-3">×{count}</span>
              </span>
            ))}
            <button
              type="button"
              onClick={onToggleReveal}
              className="btn btn-quiet ml-auto h-6 px-2 text-[11px]"
              aria-pressed={reveal}
            >
              {reveal ? 'Hide values' : 'Show values'}
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="bg-panel-2 text-[10px] uppercase tracking-[0.07em] text-fg-3">
                  <th className="w-[28%] px-2 py-1.5 font-semibold">Kind</th>
                  <th className="px-2 py-1.5 font-semibold">Matched value</th>
                  <th className="w-[23%] px-2 py-1.5 font-semibold">Offsets</th>
                </tr>
              </thead>
              <tbody>
                {data.entities.slice(0, 10).map((entity, index) => (
                  <tr key={`${entity.start}-${index}`} className="border-t border-line align-top">
                    <td className="px-2 py-1.5">
                      <span
                        className={`mono text-[11px] ${
                          isHighSensitivity(entity.type) ? 'text-[#f0c48a]' : 'text-[#8be6d3]'
                        }`}
                      >
                        {entity.type}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="mono break-all text-[11.5px] text-fg">
                        {reveal ? entity.value : '•'.repeat(Math.min(18, Math.max(4, entity.value.length)))}
                      </span>
                    </td>
                    <td className="mono px-2 py-1.5 text-[10.5px] text-fg-3">
                      {entity.start}–{entity.end}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.entities.length > 10 ? (
              <div className="border-t border-line bg-panel-2 px-2 py-1.5 text-[10.5px] text-fg-3">
                Showing 10 of {data.entities.length} findings.
              </div>
            ) : null}
          </div>
        </div>
      )}
    </StageShell>
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
    <StageShell
      title="Inspect · script behaviour"
      endpoint="POST /script"
      icon={<CodeIcon size={14} />}
      stage={stage}
      aside={data ? <VerdictChip verdict={data.verdict} /> : undefined}
    >
      {!data ? (
        <EmptyHint>
          Inspect runs only for the “Script / command” content type. Nothing is executed — this is static analysis.
        </EmptyHint>
      ) : (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label">Malicious</div>
              <div className="mt-0.5 text-[23px] font-semibold leading-none tracking-tight text-fg">
                {pct(data.malicious)}
              </div>
            </div>
            <div>
              <div className="label">Suspicious</div>
              <div className="mt-0.5 text-[23px] font-semibold leading-none tracking-tight text-fg-2">
                {pct(data.suspicious)}
              </div>
            </div>
          </div>

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

          {data.category ? (
            <div className="flex items-baseline gap-2 text-[11.5px]">
              <span className="label">Category</span>
              <span className="text-fg-2">{data.category}</span>
            </div>
          ) : null}

          {data.evidence.length > 0 ? (
            <EvidencePointer count={data.evidence.length} noun="flagged line" />
          ) : (
            <p className="text-[11.5px] text-fg-3">No specific lines were flagged.</p>
          )}

          <p className="text-[11px] leading-relaxed text-fg-3">
            Static assessment only. A benign verdict is not an execution authorization.
          </p>
        </div>
      )}
    </StageShell>
  );
}
