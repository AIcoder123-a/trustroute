'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEMO_CASES } from '@/lib/cases';
import { buildReport } from '@/lib/report';
import {
  detectionFootnote,
  headerModeLabel,
  headerModeTitle,
  heroSteps,
  runOriginLabel,
} from '@/lib/copy';
import type {
  AnalyzeResponse,
  AuditRecord,
  ContentType,
  Decision,
  DemoCase,
  ReviewAction,
  ReviewEvent,
} from '@/lib/types';
import { CONTENT_TYPE_LABELS } from '@/lib/types';
import { CaseRail, CaseStrip, ContentTypeTabs } from '@/components/CaseRail';
import { ContentView } from '@/components/ContentView';
import { DecisionPanel } from '@/components/DecisionPanel';
import { EvidencePanel } from '@/components/EvidencePanel';
import { ReportDialog } from '@/components/ReportDialog';
import { SessionTrail } from '@/components/SessionTrail';
import { GuardCard, InspectCard, ProtectCard } from '@/components/stages';
import { DecisionBadge, UnavailableBadge } from '@/components/ui';
import {
  AlertIcon,
  ArrowRightIcon,
  CodeIcon,
  RefreshIcon,
  DocumentIcon,
  EyeIcon,
  LoaderIcon,
  LockIcon,
  RouteIcon,
  ScanIcon,
  ShieldIcon,
  XIcon,
} from '@/components/icons';

type RunState = 'idle' | 'loading' | 'ready' | 'error';

export function Workbench({
  mode,
  limits,
}: {
  mode: 'live' | 'mock';
  limits: { proseCharacters: number; scriptCharacters: number };
}) {
  const [contentType, setContentType] = useState<ContentType>('support_ticket');
  const [text, setText] = useState('');
  const [activeCase, setActiveCase] = useState<DemoCase | null>(null);
  const [runState, setRunState] = useState<RunState>('idle');
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<{ title: string; detail: string; retryable: boolean } | null>(null);
  const [review, setReview] = useState<ReviewEvent | null>(null);
  const [reveal, setReveal] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [focus, setFocus] = useState<{ start: number; end: number; id: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [editInput, setEditInput] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Monotonic run id. A response is only applied when it belongs to the newest
   * request — otherwise a slow first screen could overwrite the result of a
   * second one the reviewer started after cancelling.
   */
  const runSeq = useRef(0);

  const limit = contentType === 'script' ? limits.scriptCharacters : limits.proseCharacters;
  const overLimit = text.length > limit;
  const canAnalyze = text.trim().length > 0 && !overLimit && runState !== 'loading';

  const refreshAudit = useCallback(async () => {
    try {
      const response = await fetch('/api/audit', { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { records: AuditRecord[] };
      setAudit(body.records);
    } catch {
      // The trail is a convenience; a failure to read it must not affect screening.
    }
  }, []);

  const resetRun = useCallback(() => {
    setEditInput(false);
    setResult(null);
    setReview(null);
    setError(null);
    setFocus(null);
    setRunState('idle');
  }, []);

  const analyze = useCallback(
    async (content?: { text: string; contentType: ContentType; activeCase: DemoCase | null }) => {
      const payload = content ?? { text, contentType, activeCase };
      if (payload.text.trim().length === 0) {
        setError({ title: 'Nothing to screen', detail: 'Add some text or load a demo case first.', retryable: false });
        setRunState('error');
        return;
      }

      setRunState('loading');
      setEditInput(false);
      setError(null);
      setReview(null);
      setNotice(null);
      setFocus(null);

      const controller = new AbortController();
      abortRef.current = controller;
      const seq = runSeq.current + 1;
      runSeq.current = seq;

      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text: payload.text,
            contentType: payload.contentType,
            caseId: payload.activeCase?.id ?? null,
            caseTitle: payload.activeCase?.title ?? null,
            instructions: payload.activeCase?.instructions ?? null,
          }),
        });

        const body = (await response.json()) as
          | AnalyzeResponse
          | { error?: string; message?: string; hint?: string };

        if (seq !== runSeq.current) return;

        if (!response.ok) {
          const failure = body as { error?: string; message?: string; hint?: string };
          const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
          const base = failure.message ?? 'The server did not return a usable response.';
          setResult(null);
          setError({
            title:
              response.status === 429
                ? 'Rate limited'
                : response.status === 503
                  ? 'Screening unavailable'
                  : response.status === 400
                    ? 'Input rejected'
                    : 'Screening failed',
            detail:
              response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
                ? `This browser has used its screening allowance. Try again in ${retryAfter} second${
                    retryAfter === 1 ? '' : 's'
                  }. Nothing was screened and nothing was released.`
                : failure.hint
                  ? `${base} ${failure.hint}`
                  : base,
            retryable: response.status !== 400,
          });
          setRunState('error');
          return;
        }

        setResult(body as AnalyzeResponse);
        setRunState('ready');
        void refreshAudit();
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      } catch (cause) {
        if (seq !== runSeq.current) return;
        if (cause instanceof Error && cause.name === 'AbortError') {
          // The reviewer stopped it. Nothing was decided, so there is no result
          // and no decision to override — say that instead of "network error".
          setResult(null);
          setRunState('idle');
          setNotice('Screening cancelled before a decision was made. Nothing was screened and nothing was released.');
          return;
        }
        setResult(null);
        setError({
          title: 'Network error',
          detail:
            cause instanceof Error
              ? `${cause.message}. The screening request never completed — nothing was released.`
              : 'The screening request never completed.',
          retryable: true,
        });
        setRunState('error');
      } finally {
        // Only the newest request owns the ref; a stale one must not clear it.
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [activeCase, contentType, text, refreshAudit],
  );

  const loadCase = useCallback(
    (item: DemoCase) => {
      setActiveCase(item);
      setContentType(item.contentType);
      setText(item.text);
      setNotice(null);
      resetRun();
      textareaRef.current?.focus();
    },
    [resetRun],
  );

  /** One click for a first-time reader: load an example and screen it. */
  const runCase = useCallback(
    (item: DemoCase) => {
      setActiveCase(item);
      setContentType(item.contentType);
      setText(item.text);
      setNotice(null);
      setFocus(null);
      void analyze({ text: item.text, contentType: item.contentType, activeCase: item });
    },
    [analyze],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const submitReview = useCallback(
    async (action: ReviewAction, note: string) => {
      if (!result) return;
      const decisionBefore: Decision = result.policy.decision;
      const decisionAfter: Decision = action === 'approve' ? 'PASS' : action === 'reject' ? 'BLOCK' : decisionBefore;

      setReviewBusy(true);
      try {
        const response = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId: result.runId,
            action,
            note: note.length > 0 ? note : null,
            decisionBefore,
            decisionAfter,
          }),
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(failure?.message ?? `Review endpoint returned ${response.status}`);
        }
        const body = (await response.json()) as { event: ReviewEvent };
        setReview(body.event);
        void refreshAudit();
        setNotice(
          action === 'approve'
            ? 'Approved internally. The content would now be released to the agent as the masked copy.'
            : action === 'reject'
              ? 'Rejected. The content stays blocked inside TrustRoute.'
              : 'Review recorded.',
        );
      } catch (cause) {
        setNotice(
          cause instanceof Error && cause.message.length > 0
            ? `Could not record the review: ${cause.message}`
            : 'Could not record the review — the internal state was not changed.',
        );
      } finally {
        setReviewBusy(false);
      }
    },
    [result, refreshAudit],
  );

  const report = useMemo(() => (result ? buildReport(result, review) : null), [result, review]);

  const exportJson = useCallback(() => {
    if (!report || !result) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `trustroute-${result.runId.slice(0, 12)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [report, result]);

  useEffect(() => {
    void refreshAudit();
  }, [refreshAudit]);

  // A screened request can take a few seconds; without a clock the interface
  // looks frozen and people press Screen again, spending credits twice.
  useEffect(() => {
    if (runState !== 'loading') {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const ticker = setInterval(() => setElapsed(Date.now() - started), 200);
    return () => clearInterval(ticker);
  }, [runState]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(460, Math.max(200, el.scrollHeight))}px`;
  }, [text, contentType, result]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canAnalyze) {
        event.preventDefault();
        void analyze();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [analyze, canAnalyze]);

  const busy = runState === 'loading';
  // Once there is a result, the text itself is shown highlighted in the content
  // view; keeping the full textarea open only pushes the decision off screen.
  const inputCollapsed = result !== null && !busy && !editInput;
  const warnings = useMemo(
    () =>
      (result?.warnings ?? []).filter(
        // The banner above already says this, at full strength and before the
        // reader has seen a single number.
        (warning) => !(mode === 'mock' && /^Mock mode is active/.test(warning)),
      ),
    [result, mode],
  );

  return (
    <div id="app-shell" className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg border border-[#245049] bg-[#0f2a26] text-accent">
              <ShieldIcon size={17} />
            </span>
            <div className="leading-tight">
              <div className="text-[14.5px] font-semibold tracking-tight">TrustRoute</div>
              <div className="text-[11px] text-fg-3">AI Agent Security Gateway</div>
            </div>
          </div>

          <div className="ml-3 hidden items-center gap-3 text-[11.5px] text-fg-3 md:flex">
            <span className="inline-flex items-center gap-1">
              <ScanIcon size={11} /> Guard
            </span>
            <span className="inline-flex items-center gap-1">
              <LockIcon size={11} /> Protect
            </span>
            <span className="inline-flex items-center gap-1">
              <CodeIcon size={11} /> Inspect
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <a
              href="#guide"
              className="hidden text-[11.5px] text-fg-3 transition-colors hover:text-fg-2 sm:inline"
            >
              How it works
            </a>
            <span
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] ${
                mode === 'live'
                  ? 'border-[#1d5745] bg-[#0d2720] text-pass'
                  : 'border-[#6b5320] bg-[#26200f] text-review'
              }`}
              title={headerModeTitle(mode)}
            >
              <span className={`size-1.5 rounded-full ${mode === 'live' ? 'bg-pass' : 'bg-review'}`} />
              {headerModeLabel(mode)}
            </span>
          </div>
        </div>
      </header>

      {mode === 'mock' ? (
        <div className="border-b border-[#3f3316] bg-[#1a1509]">
          <div className="mx-auto flex max-w-[1680px] items-start gap-2 px-4 py-2">
            <AlertIcon size={13} className="mt-[3px] shrink-0 text-review" />
            <div className="min-w-0">
              <p className="text-[12px] leading-relaxed text-[#e0c58c]">
                <span className="font-semibold uppercase tracking-[0.06em]">DEMO · SIMULATED RESULTS</span>
                <span className="mx-1.5 opacity-60">—</span>
                no Clocked API call is made. All three detections come from a local simulator and are not Clocked
                verdicts or probabilities.
              </p>
              <details className="group mt-1">
                <summary className="cursor-pointer list-none text-[11px] font-medium text-[#c9a86a]">
                  <span className="inline-block text-[8px] transition-transform group-open:rotate-90" aria-hidden="true">
                    ▶
                  </span>{' '}
                  Why is this a demo and not the live API?
                </summary>
                <p className="mt-1 max-w-[110ch] text-[11px] leading-relaxed text-[#bda67c]">
                  The integration is real and was verified: on 2026-10-30 all three endpoints returned live detections
                  (injection 0.9957 critical, six personal-data entities, a malicious script at 0.9956) and those exact
                  responses are committed as test fixtures. What fails from this host is transport — the service edge
                  answers non-browser clients with an HTML challenge (HTTP 403,{' '}
                  <code className="mono">cf-mitigated: challenge</code>) before authentication, and we have not yet
                  established why. The product calls Clocked from the server only, so it reports the failure and holds
                  the content instead of guessing. Adding <code className="mono">CLOCKED_API_KEY</code> to{' '}
                  <code className="mono">.env.local</code> and restarting switches the workbench to live mode; it never
                  falls back to this simulator on its own.
                </p>
              </details>
            </div>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-[1680px] px-4 py-4">
        {runState === 'idle' && !result ? (
          <Hero mode={mode} onRunCase={runCase} onLoadCase={loadCase} />
        ) : (
          <ContextBar mode={mode} needsExample={runState === 'idle'} onLoadCase={loadCase} />
        )}

        <div className="lg:hidden">
          <CaseStrip cases={DEMO_CASES} activeId={activeCase?.id ?? null} onSelect={loadCase} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[236px_minmax(0,1fr)_364px]">
          <div className="order-3 hidden min-w-0 lg:order-1 lg:block">
            <div className="lg:sticky lg:top-[68px] lg:space-y-3">
              <CaseRail cases={DEMO_CASES} activeId={activeCase?.id ?? null} onSelect={loadCase} />
              <SessionTrail records={audit} />
              <p className="px-1 text-[11px] leading-relaxed text-fg-3">
                TrustRoute screens input. It never runs a script, sends a message or calls a downstream tool.
              </p>
            </div>
          </div>

          <div className="order-1 min-w-0 space-y-3 lg:order-2">
            {inputCollapsed ? (
              <section
                className="panel flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3.5 py-2.5"
                aria-label="Screened input"
              >
                <DocumentIcon size={13} className="shrink-0 text-fg-3" />
                <span className="text-[12.5px] font-medium text-fg">{CONTENT_TYPE_LABELS[contentType]}</span>
                <span className="mono text-[11px] text-fg-3">
                  {text.length.toLocaleString()} chars · {result?.input.words.toLocaleString()} words
                </span>
                {activeCase ? (
                  <span className="chip h-[22px] px-2 text-[10.5px]">{activeCase.title}</span>
                ) : null}
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn btn-quiet h-7 px-2 text-[11.5px]"
                    onClick={() => {
                      setEditInput(true);
                      requestAnimationFrame(() => textareaRef.current?.focus());
                    }}
                  >
                    <DocumentIcon size={12} />
                    Edit content
                  </button>
                  <button type="button" className="btn h-7 px-2.5 text-[11.5px]" onClick={() => void analyze()}>
                    <RefreshIcon size={12} />
                    Screen again
                  </button>
                </div>
              </section>
            ) : (
            <section className="panel overflow-hidden" aria-label="Untrusted input">
              <header className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                <h2 className="mr-1 text-[13.5px] font-semibold tracking-tight">Untrusted input</h2>
                <ContentTypeTabs
                  value={contentType}
                  disabled={busy}
                  onChange={(next) => {
                    setContentType(next);
                    if (activeCase && activeCase.contentType !== next) setActiveCase(null);
                    resetRun();
                  }}
                />
              </header>

              {busy ? <div className="h-[2px] w-full animate-pulse bg-accent" /> : <div className="h-px w-full bg-line" />}

              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (activeCase) setActiveCase(null);
                    if (runState !== 'loading') setRunState(result ? 'ready' : 'idle');
                  }}
                  spellCheck={false}
                  aria-label="Content to screen"
                  placeholder={
                    contentType === 'script'
                      ? 'Paste a script or command. It will be inspected statically — never executed.'
                      : 'Paste a support ticket, a retrieved web page, or the output of a tool call…'
                  }
                  className={`scroll-thin block min-h-[200px] w-full resize-none bg-transparent px-4 py-3.5 text-[13px] leading-[1.7] text-fg outline-none ${
                    contentType === 'script' ? 'mono' : ''
                  }`}
                />
                {text.length === 0 ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
                    <span className="chip h-[26px] border-dashed text-[11px] text-fg-3">or pick a demo case</span>
                  </div>
                ) : null}
              </div>

              {activeCase ? (
                <div className="inset mx-3.5 mb-2.5 flex items-start gap-2 px-3 py-2">
                  <RouteIcon size={13} className="mt-[3px] shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] leading-relaxed text-fg-2">
                      <span className="font-medium text-fg">{activeCase.title}.</span> {activeCase.teaches}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-fg-3">
                      <span className="rounded border border-line px-1.5 py-px uppercase tracking-[0.06em]">
                        preset outcome · {activeCase.expectation}
                      </span>
                      <span>What this case is built to show. Not a detection result.</span>
                    </p>
                  </div>
                </div>
              ) : null}

              <footer className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5">
                <span
                  className={`mono text-[11px] ${overLimit ? 'text-block' : text.length > limit * 0.9 ? 'text-review' : 'text-fg-3'}`}
                >
                  {text.length.toLocaleString()} / {limit.toLocaleString()}
                </span>
                <span className="text-[11px] text-fg-3">
                  {CONTENT_TYPE_LABELS[contentType]}
                </span>

                <div className="ml-auto flex items-center gap-1.5">
                  {busy ? (
                    <span className="mono text-[11px] text-fg-3" aria-live="polite">
                      {(elapsed / 1000).toFixed(1)}s
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-quiet h-8 px-2.5 text-[12px]"
                    onClick={() => {
                      setText('');
                      setActiveCase(null);
                      resetRun();
                      setNotice(null);
                    }}
                    disabled={busy || (text.length === 0 && !result)}
                  >
                    <XIcon size={13} />
                    Clear
                  </button>
                  {busy ? (
                    <button type="button" className="btn h-8 px-2.5 text-[12px]" onClick={cancel}>
                      <XIcon size={13} />
                      Cancel
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary h-8 px-3 text-[12px]"
                    onClick={() => void analyze()}
                    disabled={!canAnalyze}
                    aria-busy={busy}
                  >
                    {busy ? <LoaderIcon size={13} className="animate-spin" /> : <ScanIcon size={13} />}
                    {busy ? 'Screening…' : 'Screen content'}
                    <kbd className="mono ml-1 hidden rounded border border-black/25 px-1 text-[10px] font-normal opacity-70 sm:inline">
                      ⌘↵
                    </kbd>
                  </button>
                </div>
              </footer>
            </section>
            )}

            {error ? (
              <div className="panel border-[#6d2a30] bg-[#241014] px-3.5 py-3" role="alert">
                <div className="flex items-start gap-2">
                  <AlertIcon size={14} className="mt-0.5 shrink-0 text-block" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-fg">{error.title}</div>
                    <p className="mt-1 text-[12px] leading-relaxed text-fg-2">{error.detail}</p>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-3">
                      Nothing was released downstream. A failed screening is never treated as a pass.
                    </p>
                  </div>
                  {error.retryable ? (
                    <button type="button" className="btn h-7 shrink-0 px-2 text-[11.5px]" onClick={() => void analyze()}>
                      Retry
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {notice ? (
              <div
                className="flex items-start gap-2 rounded-lg border border-[#1d5745] bg-[#0f2019] px-3.5 py-2.5"
                role="status"
              >
                <EyeIcon size={13} className="mt-[3px] shrink-0 text-pass" />
                <p className="text-[12px] leading-relaxed text-[#a9e3c8]">{notice}</p>
              </div>
            ) : null}

            {busy ? <ScreeningSkeleton elapsed={elapsed} /> : null}

            {result && !busy ? (
              <div className="xl:hidden">
                <MobileDecisionBar
                  decision={review?.decisionAfter ?? result.policy.decision}
                  headline={result.policy.headline}
                  unavailable={result.policy.screening === 'unavailable' && review === null}
                />
              </div>
            ) : null}

            <div ref={resultRef}>
              <ContentView
                result={result}
                text={text}
                focus={focus}
                onLocate={(span) => setFocus({ start: span.start, end: span.end, id: `mask-${span.type}` })}
              />
            </div>

            {result && !busy ? (
              <div className="space-y-3">
                <EvidencePanel
                  result={result}
                  text={text}
                  focusId={focus?.id ?? null}
                  onLocate={(row) => setFocus({ start: row.start, end: row.end, id: row.id })}
                />

                <div className="flex items-end justify-between gap-2">
                  <h2 className="text-[12.5px] font-semibold tracking-tight text-fg-2">Detection stages</h2>
                  <span className="text-[11px] text-fg-3">
                    {runOriginLabel(result.stages.guard.mode)} · {result.input.characters.toLocaleString()} chars
                  </span>
                </div>
                <GuardCard stage={result.stages.guard} thresholds={result.policy.thresholds} />
                <ProtectCard
                  stage={result.stages.protect}
                  reveal={reveal}
                  onToggleReveal={() => setReveal((value) => !value)}
                />
                {result.stages.inspect.status === 'skipped' ? (
                  <div className="panel px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <CodeIcon size={13} className="text-fg-3" />
                      <span className="text-[12.5px] text-fg-2">Inspect not requested</span>
                      <span className="text-[11.5px] text-fg-3">
                        — the selected content type is {CONTENT_TYPE_LABELS[contentType]}, not a script.
                      </span>
                    </div>
                  </div>
                ) : (
                  <InspectCard stage={result.stages.inspect} thresholds={result.policy.thresholds} sourceText={text} />
                )}

                {warnings.length > 0 ? (
                  <ul className="space-y-1.5 px-1">
                    {warnings.map((warning) => (
                      <li key={warning} className="flex gap-2 text-[11.5px] leading-relaxed text-fg-3">
                        <span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-3/70" aria-hidden="true" />
                        {warning}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <p className="pb-2 text-[11px] leading-relaxed text-fg-3">{detectionFootnote(result.mode)}</p>
              </div>
            ) : null}

            {!result && !busy ? <IdleEmptyState onLoadCase={loadCase} /> : null}
          </div>

          <div className="order-2 min-w-0 xl:order-3">
            <div id="decision" className="scroll-mt-[72px] xl:sticky xl:top-[68px]">
              <DecisionPanel
                result={result}
                review={review}
                busy={busy || reviewBusy}
                onApprove={(note) => void submitReview('approve', note)}
                onReject={(note) => void submitReview('reject', note)}
                onRecheck={() => void analyze()}
                onExport={exportJson}
                onPrint={() => setReportOpen(true)}
              />
            </div>
          </div>
        </div>

        <footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 pb-4 text-[11px] text-fg-3">
          <span>TrustRoute · built for the Clocked Build Challenge 2026</span>
          <span className="hidden sm:inline">·</span>
          <span>Guard, Protect and Inspect are Clocked endpoints</span>
          <span className="ml-auto flex items-center gap-1.5">
            <LockIcon size={11} />
            API key stays server-side
          </span>
        </footer>
      </main>

      {reportOpen && report ? (
        <ReportDialog report={report} onClose={() => setReportOpen(false)} onDownload={exportJson} />
      ) : null}
    </div>
  );
}

function MobileDecisionBar({
  decision,
  headline,
  unavailable,
}: {
  decision: Decision;
  headline: string;
  unavailable: boolean;
}) {
  return (
    <div className="panel flex items-center gap-2.5 px-3 py-2.5" data-screening={unavailable ? 'unavailable' : 'complete'}>
      {unavailable ? <UnavailableBadge /> : <DecisionBadge decision={decision} />}
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-fg-2">{headline}</p>
      <a href="#decision" className="btn h-7 shrink-0 px-2 text-[11.5px]">
        Why
        <ArrowRightIcon size={11} />
      </a>
    </div>
  );
}

function ScreeningSkeleton({ elapsed }: { elapsed: number }) {
  const stages = ['Guard · scoring injection', 'Protect · finding personal data', 'Inspect · reading the script'];
  return (
    <div className="panel px-3.5 py-3" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2">
        <LoaderIcon size={13} className="animate-spin text-accent" />
        <span className="text-[12.5px] font-medium text-fg">Screening</span>
        <span className="mono ml-auto text-[11px] text-fg-3">{(elapsed / 1000).toFixed(1)}s</span>
      </div>
      <ul className="mt-2.5 space-y-2">
        {stages.map((stage) => (
          <li key={stage} className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-fg-3/40" aria-hidden="true" />
            <span className="text-[11.5px] text-fg-3">{stage}</span>
            <span className="ml-auto h-[5px] w-20 animate-pulse rounded-full bg-panel-3" />
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[11px] leading-relaxed text-fg-3">
        A full screen normally takes one to three seconds. Cancel leaves nothing screened and nothing released.
      </p>
    </div>
  );
}

function Hero({
  mode,
  onRunCase,
  onLoadCase,
}: {
  mode: 'live' | 'mock';
  onRunCase: (item: DemoCase) => void;
  onLoadCase: (item: DemoCase) => void;
}) {
  const steps = heroSteps(mode);
  const injection = DEMO_CASES.find((item) => item.expectation === 'block');
  const pii = DEMO_CASES.find((item) => item.id === 'pii-ticket');

  return (
    <section className="mb-4" id="guide">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip h-[22px] border-[#245049] bg-[#0f2a26] px-2 text-[10px] uppercase tracking-[0.09em] text-[#8be6d3]">
          Agent input screening
        </span>
        <span className="text-[11px] text-fg-3">
          {mode === 'live' ? 'Live Clocked API' : 'Simulated detections · no API call'}
        </span>
      </div>
      <h1 className="mt-2.5 max-w-[38ch] text-[25px] font-semibold leading-[1.18] tracking-[-0.02em] text-fg sm:text-[29px]">
        Untrusted content should be inspected before it influences an agent.
      </h1>
      <p className="mt-2 max-w-[76ch] text-[13.5px] leading-relaxed text-fg-2">
        A ticket can carry personal data, a web page can carry instructions, and a tool result can carry a script your
        automation is about to run. TrustRoute screens all three, masks what should not travel, and returns a decision
        you can defend to a reviewer.
      </p>

      {injection || pii ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.07em] text-fg-3">Start with</span>
          {injection ? (
            <button
              type="button"
              className="btn btn-primary h-8 px-3 text-[12px]"
              onClick={() => onRunCase(injection)}
              data-testid="try-blocked"
            >
              <ScanIcon size={13} />
              Screen the blocked example
            </button>
          ) : null}
          {pii ? (
            <button
              type="button"
              className="btn h-8 px-3 text-[12px]"
              onClick={() => onLoadCase(pii)}
              data-testid="try-masking"
            >
              <LockIcon size={13} />
              Load a masking example
            </button>
          ) : null}
          <span className="text-[11px] text-fg-3">
            One click runs all three checks plus the decision — about two seconds.
          </span>
        </div>
      ) : null}

      <ol className="mt-3.5 hidden gap-2 sm:grid sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="panel flex gap-2.5 px-3 py-2.5">
            <span className="mt-[1px] flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-accent">
              {index === 0 ? <DocumentIcon size={14} /> : index === 1 ? <ScanIcon size={14} /> : <ShieldIcon size={14} />}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="mono text-[10px] text-fg-3">0{index + 1}</span>
                <span className="text-[12.5px] font-medium text-fg">{step.title}</span>
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-fg-3">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Compact replacement for the hero once a run exists, so results start higher. */
function ContextBar({
  mode,
  needsExample,
  onLoadCase,
}: {
  mode: 'live' | 'mock';
  needsExample: boolean;
  onLoadCase: (item: DemoCase) => void;
}) {
  return (
    <div id="guide" className="mb-3 flex scroll-mt-[72px] flex-wrap items-center gap-x-3 gap-y-1">
      <h1 className="text-[13px] font-semibold tracking-tight text-fg-2">
        Screen untrusted content before an agent reads it
      </h1>
      <span className="text-[11px] text-fg-3">
        {mode === 'live' ? 'Live Clocked API' : 'Simulated detections'}
      </span>
      {needsExample ? (
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-fg-3">
          No case loaded —
          <button
            type="button"
            className="text-accent underline decoration-dotted underline-offset-2"
            onClick={() => {
              const first = DEMO_CASES[0];
              if (first) onLoadCase(first);
            }}
          >
            pick one from the list
          </button>
        </span>
      ) : null}
    </div>
  );
}

function IdleEmptyState({ onLoadCase }: { onLoadCase: (item: DemoCase) => void }) {
  const example = DEMO_CASES.find((item) => item.expectation === 'block');
  return (
    <div className="panel flex flex-wrap items-center gap-2.5 px-3.5 py-3">
      <ArrowRightIcon size={14} className="shrink-0 text-fg-3" />
      <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-fg-3">
        Results appear here: the decision on the right, the passages behind it in the evidence list, and the copy that
        would be forwarded in the view above.
      </p>
      {example ? (
        <button type="button" className="btn h-7 px-2 text-[11.5px]" onClick={() => onLoadCase(example)}>
          Load an example
        </button>
      ) : null}
    </div>
  );
}
