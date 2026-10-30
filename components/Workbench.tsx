'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEMO_CASES, DEFAULT_INSTRUCTIONS } from '@/lib/cases';
import { buildReport } from '@/lib/report';
import type { AnalyzeResponse, ContentType, DemoCase, Decision, ReviewAction, ReviewEvent } from '@/lib/types';
import { CONTENT_TYPE_LABELS } from '@/lib/types';
import { CaseRail, CaseStrip, ContentTypeTabs } from '@/components/CaseRail';
import { ContentView } from '@/components/ContentView';
import { DecisionPanel } from '@/components/DecisionPanel';
import { ReportDialog } from '@/components/ReportDialog';
import { GuardCard, InspectCard, ProtectCard } from '@/components/stages';
import {
  AlertIcon,
  ArrowRightIcon,
  CodeIcon,
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const limit = contentType === 'script' ? limits.scriptCharacters : limits.proseCharacters;
  const overLimit = text.length > limit;
  const canAnalyze = text.trim().length > 0 && !overLimit && runState !== 'loading';

  const instructions = useMemo(
    () => activeCase?.instructions ?? DEFAULT_INSTRUCTIONS[contentType],
    [activeCase, contentType],
  );

  const resetRun = useCallback(() => {
    setResult(null);
    setReview(null);
    setError(null);
    setRunState('idle');
  }, []);

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

  const analyze = useCallback(
    async (content?: { text: string; contentType: ContentType; activeCase: DemoCase | null }) => {
      const payload = content ?? { text, contentType, activeCase };
      if (payload.text.trim().length === 0) {
        setError({ title: 'Nothing to screen', detail: 'Add some text or load a demo case first.', retryable: false });
        setRunState('error');
        return;
      }

      setRunState('loading');
      setError(null);
      setReview(null);
      setNotice(null);

      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

        if (!response.ok) {
          const failure = body as { error?: string; message?: string; hint?: string };
          setResult(null);
          setError({
            title:
              response.status === 429
                ? 'Rate limited'
                : response.status === 503
                  ? 'Screening is not configured'
                  : response.status === 400
                    ? 'Input rejected'
                    : 'Screening failed',
            detail: failure.message ?? 'The server did not return a usable response.',
            retryable: response.status !== 400,
          });
          setRunState('error');
          return;
        }

        setResult(body as AnalyzeResponse);
        setRunState('ready');
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      } catch (cause) {
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
      }
    },
    [activeCase, contentType, text],
  );

  const submitReview = useCallback(
    async (action: ReviewAction) => {
      if (!result) return;
      const decisionBefore: Decision = result.policy.decision;
      const decisionAfter: Decision = action === 'approve' ? 'PASS' : action === 'reject' ? 'BLOCK' : decisionBefore;

      setReviewBusy(true);
      try {
        const response = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: result.runId, action, note: null, decisionBefore, decisionAfter }),
        });
        if (!response.ok) throw new Error(`Review endpoint returned ${response.status}`);
        const body = (await response.json()) as { event: ReviewEvent };
        setReview(body.event);
        setNotice(
          action === 'approve'
            ? 'Approved internally. The content would now be released to the agent as the masked copy.'
            : action === 'reject'
              ? 'Rejected. The content stays blocked inside TrustRoute.'
              : 'Review recorded.',
        );
      } catch {
        setNotice('Could not record the review — the internal state was not changed.');
      } finally {
        setReviewBusy(false);
      }
    },
    [result],
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
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(460, Math.max(220, el.scrollHeight))}px`;
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

  return (
    <div id="app-shell" className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg border border-[#245049] bg-[#0f2a26] text-accent">
              <ShieldIcon size={17} />
            </span>
            <div className="leading-tight">
              <div className="text-[14px] font-semibold tracking-tight">TrustRoute</div>
              <div className="text-[10.5px] text-fg-3">AI Agent Security Gateway</div>
            </div>
          </div>

          <div className="ml-2 hidden items-center gap-3 text-[11px] text-fg-3 md:flex">
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
            <span
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] ${
                mode === 'live'
                  ? 'border-[#1d5745] bg-[#0d2720] text-pass'
                  : 'border-[#6b5320] bg-[#26200f] text-review'
              }`}
              title={mode === 'live' ? 'Live Clocked API responses' : 'No API key: synthetic results'}
            >
              <span className={`size-1.5 rounded-full ${mode === 'live' ? 'bg-pass' : 'bg-review'}`} />
              {mode === 'live' ? 'Live' : 'Mock'}
            </span>
          </div>
        </div>
      </header>

      {mode === 'mock' ? (
        <div className="border-b border-[#3f3316] bg-[#1a1509]">
          <div className="mx-auto flex max-w-[1680px] items-start gap-2 px-4 py-2">
            <AlertIcon size={13} className="mt-[3px] shrink-0 text-review" />
            <p className="text-[11.5px] leading-relaxed text-[#d9bd82]">
              <span className="font-semibold">Mock preview — no Clocked API key is configured.</span> Detections below
              come from a local heuristic simulator, not from Clocked, and must not be read as Clocked verdicts. Add{' '}
              <code className="mono rounded bg-black/30 px-1 py-px text-[10.5px]">CLOCKED_API_KEY</code> to{' '}
              <code className="mono rounded bg-black/30 px-1 py-px text-[10.5px]">.env.local</code> and restart to screen
              with the live API. The policy engine, redaction and review flow are identical in both modes.
            </p>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-[1680px] px-4 py-4">
        {runState === 'idle' && !result ? <Hero /> : null}

        <div className="lg:hidden">
          <CaseStrip cases={DEMO_CASES} activeId={activeCase?.id ?? null} onSelect={loadCase} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)_356px]">
          <div className="order-3 hidden min-w-0 lg:order-1 lg:block">
            <div className="lg:sticky lg:top-[72px] lg:space-y-3">
              <CaseRail cases={DEMO_CASES} activeId={activeCase?.id ?? null} onSelect={loadCase} />
              <div className="panel hidden px-3 py-3 xl:block">
                <h2 className="label mb-1.5">Screening boundary</h2>
                <p className="text-[11px] leading-relaxed text-fg-3">
                  TrustRoute screens input. It never runs a script, sends a message or calls a downstream tool — the
                  decision is advisory for whatever orchestrator sits behind it.
                </p>
              </div>
            </div>
          </div>

          <div className="order-1 min-w-0 space-y-3 lg:order-2">
            <section className="panel overflow-hidden" aria-label="Untrusted input">
              <header className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
                <h2 className="mr-1 text-[13px] font-semibold tracking-tight">Untrusted input</h2>
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

              {busy ? <div className="h-[2px] w-full animate-pulse bg-accent" /> : null}

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
                  className={`scroll-thin block min-h-[220px] w-full resize-none bg-transparent px-4 py-3.5 text-[12.5px] leading-[1.75] text-fg outline-none ${
                    contentType === 'script' ? 'mono' : ''
                  }`}
                />
                {text.length === 0 ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
                    <span className="chip h-[26px] border-dashed text-[10.5px] text-fg-3">or load a demo case</span>
                  </div>
                ) : null}
              </div>

              {activeCase ? (
                <div className="border-t border-line bg-panel-2 px-3.5 py-2.5">
                  <div className="flex items-start gap-2">
                    <RouteIcon size={13} className="mt-[3px] shrink-0 text-accent" />
                    <p className="text-[11.5px] leading-relaxed text-fg-2">
                      <span className="font-medium text-fg">{activeCase.title}.</span> {activeCase.teaches}
                    </p>
                  </div>
                </div>
              ) : null}

              {notice ? (
                <div className="flex items-start gap-2 border-t border-line bg-[#0f2019] px-3.5 py-2">
                  <EyeIcon size={13} className="mt-[3px] shrink-0 text-pass" />
                  <p className="text-[11.5px] leading-relaxed text-[#9fdcbf]">{notice}</p>
                </div>
              ) : null}

              <footer className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5">
                <span
                  className={`mono text-[10.5px] ${overLimit ? 'text-block' : text.length > limit * 0.9 ? 'text-review' : 'text-fg-3'}`}
                >
                  {text.length.toLocaleString()} / {limit.toLocaleString()} chars
                </span>
                <span className="text-[10.5px] text-fg-3">·</span>
                <span className="text-[10.5px] text-fg-3">
                  {CONTENT_TYPE_LABELS[contentType]} · policy {instructions ? 'custom' : 'default'}
                </span>

                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn btn-quiet h-8 px-2.5 text-[11.5px]"
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
                  <button
                    type="button"
                    className="btn btn-primary h-8 px-3 text-[11.5px]"
                    onClick={() => void analyze()}
                    disabled={!canAnalyze}
                  >
                    {busy ? <LoaderIcon size={13} className="animate-spin" /> : <ScanIcon size={13} />}
                    {busy ? 'Screening…' : 'Screen content'}
                    <kbd className="mono ml-1 hidden rounded border border-black/25 px-1 text-[9.5px] font-normal opacity-70 sm:inline">
                      ⌘↵
                    </kbd>
                  </button>
                </div>
              </footer>
            </section>

            {error ? (
              <div className="panel border-[#6d2a30] bg-[#241014] px-3.5 py-3" role="alert">
                <div className="flex items-start gap-2">
                  <AlertIcon size={14} className="mt-0.5 shrink-0 text-block" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-fg">{error.title}</div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-2">{error.detail}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-fg-3">
                      Nothing was released downstream. A failed screening is never treated as a pass.
                    </p>
                  </div>
                  {error.retryable ? (
                    <button type="button" className="btn h-7 shrink-0 px-2 text-[11px]" onClick={() => void analyze()}>
                      Retry
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div ref={resultRef}>
              <ContentView result={result} text={text} />
            </div>

            {result ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[12px] font-semibold tracking-tight text-fg-2">Detection stages</h2>
                  <span className="text-[10.5px] text-fg-3">
                    {result.stages.guard.mode === 'live' ? 'Live Clocked API' : 'Mock mode · synthetic'} ·{' '}
                    {result.input.characters.toLocaleString()} chars
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
                    <div className="flex items-center gap-2">
                      <CodeIcon size={13} className="text-fg-3" />
                      <span className="text-[12px] text-fg-2">Inspect skipped</span>
                      <span className="text-[11px] text-fg-3">
                        — selected content type is {CONTENT_TYPE_LABELS[contentType]}, not a script.
                      </span>
                    </div>
                  </div>
                ) : (
                  <InspectCard stage={result.stages.inspect} thresholds={result.policy.thresholds} sourceText={text} />
                )}

                {result.warnings.length > 0 ? (
                  <ul className="space-y-1 rounded-lg border border-line bg-panel px-3.5 py-2.5">
                    {result.warnings.map((warning) => (
                      <li key={warning} className="flex gap-2 text-[11px] leading-relaxed text-fg-3">
                        <span className="mt-[6px] size-1 shrink-0 rounded-full bg-fg-3/70" aria-hidden="true" />
                        {warning}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <p className="pb-2 text-[10.5px] leading-relaxed text-fg-3">
                  Detections are model estimates returned by Clocked for this exact input. The decision above is
                  produced by TrustRoute&apos;s own rule engine and can be inspected in{' '}
                  <code className="mono">lib/policy.ts</code>.
                </p>
              </div>
            ) : (
              <IdleEmptyState />
            )}
          </div>

          <div className="order-2 min-w-0 xl:order-3">
            <div className="xl:sticky xl:top-[72px]">
              <DecisionPanel
                result={result}
                review={review}
                busy={busy || reviewBusy}
                onApprove={() => void submitReview('approve')}
                onReject={() => void submitReview('reject')}
                onRecheck={() => void analyze()}
                onExport={exportJson}
                onPrint={() => setReportOpen(true)}
              />
            </div>
          </div>
        </div>

        <footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 pb-4 text-[10.5px] text-fg-3">
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

function Hero() {
  const steps = [
    {
      icon: <DocumentIcon size={14} />,
      title: 'Paste untrusted content',
      body: 'A support ticket, a retrieved page, tool output or a script — the things an agent reads without suspicion.',
    },
    {
      icon: <ScanIcon size={14} />,
      title: 'Three Clocked checks run',
      body: 'Guard scores injection, Protect finds personal data, Inspect reads a script without running it.',
    },
    {
      icon: <ShieldIcon size={14} />,
      title: 'A policy decides, not the model',
      body: 'PASS, REVIEW or BLOCK from a deterministic server-side engine, with the evidence a human needs.',
    },
  ];

  return (
    <section className="mb-4">
      <div className="flex items-center gap-2">
        <span className="chip h-[22px] border-[#245049] bg-[#0f2a26] px-2 text-[10px] uppercase tracking-[0.09em] text-[#8be6d3]">
          Agent input screening
        </span>
      </div>
      <h1 className="mt-2.5 text-[25px] font-semibold leading-[1.18] tracking-[-0.02em] text-fg sm:text-[27px]">
        Untrusted content should be inspected{' '}
        <br className="hidden md:inline" />
        before it influences an agent.
      </h1>
      <p className="mt-2 max-w-[74ch] text-[13px] leading-relaxed text-fg-2">
        A ticket can carry personal data, a web page can carry instructions, and a tool result can carry a script your
        automation is about to run. TrustRoute screens all three, masks what should not travel, and returns a decision
        you can defend to a reviewer.
      </p>
      <ol className="mt-3.5 hidden gap-2 sm:grid sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="panel flex gap-2.5 px-3 py-2.5">
            <span className="mt-[1px] flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-accent">
              {step.icon}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="mono text-[9.5px] text-fg-3">0{index + 1}</span>
                <span className="text-[12px] font-medium text-fg">{step.title}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-fg-3">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function IdleEmptyState() {
  return (
    <div className="panel flex items-center gap-3 px-3.5 py-3">
      <ArrowRightIcon size={14} className="shrink-0 text-fg-3" />
      <p className="text-[11.5px] leading-relaxed text-fg-3">
        Results appear here after screening: the decision on the right, stage evidence below, and the forwarded copy in
        the view above.
      </p>
    </div>
  );
}
