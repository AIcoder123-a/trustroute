'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEMO_CASES } from '@/lib/cases';
import { buildReport } from '@/lib/report';
import { planReview } from '@/lib/review';
import { clockTime } from '@/lib/format';
import { detectionFootnote, headerModeLabel, headerModeTitle } from '@/lib/copy';
import type {
  AnalyzeResponse,
  AuditRecord,
  ContentType,
  DemoCase,
  ReviewAction,
  ReviewEvent,
} from '@/lib/types';
import { CONTENT_TYPE_LABELS } from '@/lib/types';
import { CasePicker, ContentTypeTabs } from '@/components/CasePicker';
import { ContentView } from '@/components/ContentView';
import { DecisionPrimer, InsightRail, ResultSummary, ScreeningConfirm, type ConfirmKind } from '@/components/DecisionPanel';
import { EvidencePanel } from '@/components/EvidencePanel';
import { ReportDialog } from '@/components/ReportDialog';
import { SessionTrail } from '@/components/SessionTrail';
import { GuardCard, InspectCard, ProtectCard } from '@/components/stages';
import {
  AlertIcon,
  ChevronRightIcon,
  DocumentIcon,
  LoaderIcon,
  LockIcon,
  PlusIcon,
  ScanIcon,
  ShieldIcon,
  XIcon,
} from '@/components/icons';

type RunState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * One screening, frozen.
 *
 * The result is never stored next to the draft: it is stored *with the exact
 * text and content type it was produced from*. Everything downstream — the
 * reader, the highlights, the evidence offsets, the character count, the
 * masked copy, the export — reads from this snapshot, so editing the draft can
 * never make an old verdict describe new text.
 */
type Screening = {
  text: string;
  contentType: ContentType;
  result: AnalyzeResponse;
};

const SHELL = 'mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8';

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
  const [screening, setScreening] = useState<Screening | null>(null);
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
  /** A live-mode re-screen waits here until the reader accepts the cost. */
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Monotonic run id. A response is only applied when it belongs to the newest
   * request — otherwise a slow first screen could overwrite the result of a
   * second one the reviewer started after cancelling.
   */
  const runSeq = useRef(0);

  const result = screening?.result ?? null;
  const limit = contentType === 'script' ? limits.scriptCharacters : limits.proseCharacters;
  const overLimit = text.length > limit;
  const canAnalyze = text.trim().length > 0 && !overLimit && runState !== 'loading';
  const busy = runState === 'loading';
  const showIntake = screening === null || editInput;
  /** The draft no longer matches the text the current result describes. */
  const draftDiffers = screening !== null && (screening.text !== text || screening.contentType !== contentType);

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
    setScreening(null);
    setReview(null);
    setError(null);
    setFocus(null);
    setConfirm(null);
    setRunState('idle');
  }, []);

  const analyze = useCallback(
    async (content?: { text: string; contentType: ContentType; activeCase: DemoCase | null }) => {
      // One screen at a time: a double click (or a stray Enter) must not spend a
      // second request while the first is still unanswered.
      if (abortRef.current) return;
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
      setConfirm(null);

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
          setScreening(null);
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

        const payloadResult = body as AnalyzeResponse;
        // The snapshot is written in the same update as the result: there is no
        // render in which a verdict exists without the text it describes.
        setScreening({
          text: payload.text,
          contentType: payload.contentType,
          result: payloadResult,
        });
        setRunState('ready');
        void refreshAudit();
        requestAnimationFrame(() => {
          const node = resultRef.current;
          if (!node) return;
          const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
          node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
          // Keyboard and screen-reader users land on the decision, not on the
          // header they were already past.
          node.focus({ preventScroll: true });
        });
      } catch (cause) {
        if (seq !== runSeq.current) return;
        if (cause instanceof Error && cause.name === 'AbortError') {
          // The reviewer stopped it. Nothing was decided, so there is no result
          // and no decision to override — say that instead of "network error".
          setScreening(null);
          setRunState('idle');
          setNotice('Screening cancelled before a decision was made. Nothing was screened and nothing was released.');
          return;
        }
        setScreening(null);
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
      requestAnimationFrame(() => textareaRef.current?.focus());
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

  /**
   * Start over: empty box, default type, no screening and no review.
   *
   * This is the only control that throws the current task away, and it is
   * deliberately inert — it never calls the screening endpoint, so a reader who
   * wants out never spends a credit doing it.
   */
  const startNewScreening = useCallback(() => {
    // Bump first: an in-flight response must not land on the empty workbench.
    runSeq.current += 1;
    const inFlight = abortRef.current;
    // Release the slot immediately — the aborted request is not going to write
    // anything, and the next screen must not be silently dropped while the
    // browser finishes rejecting the old one.
    abortRef.current = null;
    inFlight?.abort();
    setText('');
    setContentType('support_ticket');
    setActiveCase(null);
    setNotice(null);
    resetRun();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [resetRun]);

  /**
   * The gate in front of every *repeat* screen.
   *
   * In live mode a re-screen is a new paid request: it is the one action here
   * that spends money, so it asks first and does nothing if the answer is no.
   * Mock mode spends nothing, so it is not asked.
   */
  const requestScreen = useCallback(
    (kind: ConfirmKind) => {
      if (abortRef.current) return;
      if (mode === 'live' && screening !== null) {
        setConfirm(kind);
        return;
      }
      void analyze();
    },
    [analyze, mode, screening],
  );

  const confirmScreen = useCallback(() => {
    setConfirm(null);
    void analyze();
  }, [analyze]);

  const analyzeFromIntake = useCallback(() => {
    if (screening !== null) requestScreen('changes');
    else void analyze();
  }, [analyze, requestScreen, screening]);

  /** Put the draft back to the text the visible result describes. */
  const discardEdits = useCallback(() => {
    if (!screening) return;
    setText(screening.text);
    setContentType(screening.contentType);
    setConfirm(null);
  }, [screening]);

  const submitReview = useCallback(
    async (action: ReviewAction, note: string) => {
      if (!result) return;
      /**
       * The same table the route enforces, applied before a request is made.
       *
       * This is not the security boundary — the route re-derives the facts from
       * its own record — it is here so an impossible action never leaves the
       * page, and so a stale tab explains itself instead of showing a server
       * error. `planReview` returns the only outcome this run may reach, and an
       * approval of a block is not among them.
       */
      const plan = planReview({
        action,
        policyDecision: result.policy.decision,
        screening: result.policy.screening,
        requestedAfter:
          action === 'approve' ? 'PASS' : action === 'reject' ? 'BLOCK' : result.policy.decision,
        alreadyReviewed: review !== null,
      });
      if (!plan.ok) {
        setNotice(plan.message);
        return;
      }

      setReviewBusy(true);
      try {
        const response = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId: result.runId,
            action,
            note: note.length > 0 ? note : null,
            decisionBefore: result.policy.decision,
            decisionAfter: plan.decisionAfter,
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
            ? 'Approval recorded. TrustRoute has not sent anything: it is a checkpoint, not a sender.'
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
    [result, review, refreshAudit],
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
    el.style.height = `${Math.min(380, Math.max(168, el.scrollHeight))}px`;
  }, [text, contentType, showIntake]);

  useEffect(() => {
    if (editInput) requestAnimationFrame(() => textareaRef.current?.focus());
  }, [editInput]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only while the input is on screen: the shortcut is printed on that
      // button, and on the results view it would be an unannounced re-screen.
      if (!showIntake) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canAnalyze) {
        event.preventDefault();
        analyzeFromIntake();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [analyzeFromIntake, canAnalyze, showIntake]);

  const warnings = useMemo(
    () =>
      (result?.warnings ?? []).filter(
        // The header notice already says this, at full strength and before the
        // reader has seen a single number.
        (warning) => !(mode === 'mock' && /^Mock mode is active/.test(warning)),
      ),
    [result, mode],
  );

  return (
    <div id="app-shell" className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <SiteHeader mode={mode} showIntake={showIntake} onNewScreening={startNewScreening} />

      {mode === 'mock' ? <ModeNotice /> : null}

      <main id="main" tabIndex={-1} className={`${SHELL} flex-1 pb-16 pt-7 outline-none sm:pt-10`}>
        {showIntake ? (
          <Intake
            mode={mode}
            text={text}
            setText={setText}
            contentType={contentType}
            setContentType={(next) => {
              setContentType(next);
              if (activeCase && activeCase.contentType !== next) setActiveCase(null);
              // Only the *result* must not survive a type change; the draft is
              // the reader's, and the mismatch is reported instead of erased.
              if (screening) resetRun();
            }}
            activeCase={activeCase}
            onSelectCase={loadCase}
            onRunCase={runCase}
            busy={busy}
            elapsed={elapsed}
            canAnalyze={canAnalyze}
            overLimit={overLimit}
            limit={limit}
            hasScreening={screening !== null}
            changedSinceScreening={draftDiffers}
            confirm={confirm === 'changes' ? 'changes' : null}
            textareaRef={textareaRef}
            onAnalyze={analyzeFromIntake}
            onConfirm={confirmScreen}
            onCancelConfirm={() => setConfirm(null)}
            onCancel={cancel}
            onClear={() => {
              setText('');
              setActiveCase(null);
              resetRun();
              setNotice(null);
            }}
            error={error}
            notice={notice}
            audit={audit}
            onDismissEdit={
              screening
                ? () => {
                    setEditInput(false);
                    setNotice(null);
                    setConfirm(null);
                  }
                : undefined
            }
          />
        ) : (
          <Results
            screening={screening!}
            draft={{ text, contentType }}
            mode={mode}
            busy={busy}
            elapsed={elapsed}
            review={review}
            reviewBusy={reviewBusy}
            notice={notice}
            warnings={warnings}
            focus={focus}
            setFocus={setFocus}
            reveal={reveal}
            setReveal={setReveal}
            audit={audit}
            resultRef={resultRef}
            confirm={confirm}
            onNewScreening={startNewScreening}
            onEdit={() => setEditInput(true)}
            onRecheck={() => requestScreen('recheck')}
            onScreenChanges={() => requestScreen('changes')}
            onDiscardEdits={discardEdits}
            onConfirm={confirmScreen}
            onCancelConfirm={() => setConfirm(null)}
            onCancel={cancel}
            onApprove={(note) => void submitReview('approve', note)}
            onReject={(note) => void submitReview('reject', note)}
            onExport={exportJson}
            onPrint={() => setReportOpen(true)}
          />
        )}
      </main>

      <SiteFooter />

      {reportOpen && report ? (
        <ReportDialog report={report} onClose={() => setReportOpen(false)} onDownload={exportJson} />
      ) : null}
    </div>
  );
}

function SiteHeader({
  mode,
  showIntake,
  onNewScreening,
}: {
  mode: 'live' | 'mock';
  showIntake: boolean;
  onNewScreening: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className={`${SHELL} flex h-14 items-center gap-3`}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-white">
          <ShieldIcon size={16} />
        </span>
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="text-[14.5px] font-semibold tracking-tight">TrustRoute</span>
          <span className="hidden text-[11.5px] text-fg-3 sm:inline">AI agent security gateway</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* A result can be 3,000px of evidence; the way out has to be on
              screen from anywhere in it, not only at the top. This is the same
              action as the one in the result band, and it never screens. */}
          {showIntake ? null : (
            <button
              type="button"
              onClick={onNewScreening}
              aria-label="Start a new screening"
              className="btn btn-ghost btn-sm whitespace-nowrap"
            >
              <PlusIcon size={11} />
              New screening
            </button>
          )}
          <span
            className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium ${
              mode === 'live'
                ? 'border-pass-line bg-pass-soft text-pass'
                : 'border-review-line bg-review-soft text-review'
            }`}
            title={headerModeTitle(mode)}
          >
            <span className={`size-1.5 rounded-full ${mode === 'live' ? 'bg-pass' : 'bg-review'}`} />
            {headerModeLabel(mode)}
          </span>
        </div>
      </div>
    </header>
  );
}

/**
 * Provenance, stated once and in one line.
 *
 * The long explanation is still here — it is the record of why the demo runs a
 * simulator — but it is one click away instead of occupying the first screen.
 */
function ModeNotice() {
  return (
    <div className="relative border-b border-review-line bg-review-soft/70">
      <div className={`${SHELL} flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5`}>
        <AlertIcon size={12} className="shrink-0 text-review" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-review">
          DEMO · SIMULATED RESULTS
        </span>
        <span className="text-[11.5px] text-[#7a4d13]">
          <span className="sm:hidden">Local simulator, no API call.</span>
          <span className="hidden sm:inline">
            — no Clocked API call is made. Detections come from a local simulator, not from Clocked.
          </span>
        </span>
        <details className="group sm:ml-auto">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-review underline decoration-review/30 underline-offset-2 hover:decoration-review">
            Why is this a demo and not the live API?
          </summary>
          <div className="absolute inset-x-0 top-full z-30 border-b border-line bg-surface px-4 py-3 shadow-sm sm:px-6 lg:px-8">
            <div className={`${SHELL} max-w-[70ch] text-[11.5px] leading-relaxed text-fg-2`}>
              The integration is real and verified: on 2026-10-30 all three endpoints returned live detections, and those
              exact responses are committed as test fixtures. On 2026-11-01 a GitHub-hosted runner reached the same three
              endpoints with HTTP 200. What fails from this host is transport — the service edge answers non-browser
              clients with an HTML challenge before authentication. TrustRoute reports that failure and holds the
              content rather than guessing; adding a key never falls back to this simulator.
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function Intake({
  mode,
  text,
  setText,
  contentType,
  setContentType,
  activeCase,
  onSelectCase,
  onRunCase,
  busy,
  elapsed,
  canAnalyze,
  overLimit,
  limit,
  hasScreening,
  changedSinceScreening,
  confirm,
  textareaRef,
  onAnalyze,
  onConfirm,
  onCancelConfirm,
  onCancel,
  onClear,
  error,
  notice,
  audit,
  onDismissEdit,
}: {
  mode: 'live' | 'mock';
  text: string;
  setText: (value: string) => void;
  contentType: ContentType;
  setContentType: (value: ContentType) => void;
  activeCase: DemoCase | null;
  onSelectCase: (item: DemoCase) => void;
  onRunCase: (item: DemoCase) => void;
  busy: boolean;
  elapsed: number;
  canAnalyze: boolean;
  overLimit: boolean;
  limit: number;
  /** True when a result already exists behind this editor. */
  hasScreening: boolean;
  /** True when the draft no longer matches the screened text. */
  changedSinceScreening: boolean;
  confirm: ConfirmKind | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onAnalyze: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onCancel: () => void;
  onClear: () => void;
  error: { title: string; detail: string; retryable: boolean } | null;
  notice: string | null;
  audit: AuditRecord[];
  onDismissEdit?: () => void;
}) {
  const starter = DEMO_CASES.find((item) => item.expectation === 'block');

  return (
    <div id="try" className="mx-auto max-w-[820px] scroll-mt-24">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-accent">Agent input screening</p>
      <h1 className="mt-3 max-w-[20ch] text-[30px] font-semibold leading-[1.12] tracking-[-0.025em] text-fg sm:text-[38px]">
        Screen untrusted content before an agent reads it.
      </h1>
      <p className="mt-3.5 max-w-[64ch] text-[14.5px] leading-[1.65] text-fg-2">
        Paste a ticket, a retrieved page, a tool result or a script. TrustRoute checks it for injection, personal data
        and risky behaviour, then returns a decision with the evidence behind it.
      </p>

      <div className="card mt-7">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-2.5">
          <ContentTypeTabs value={contentType} disabled={busy} onChange={setContentType} />
        </div>

        <div className="border-t border-line">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            aria-label="Content to screen"
            placeholder={
              contentType === 'script'
                ? 'Paste a script or command. It is inspected statically — never executed.'
                : 'Paste the text an agent is about to read…'
            }
            className={`scroll-thin block min-h-[168px] w-full resize-none bg-transparent px-4 py-3.5 text-[13.5px] leading-[1.7] text-fg outline-none ${
              contentType === 'script' ? 'mono' : ''
            }`}
          />
        </div>

        {activeCase ? (
          <div className="flex items-start gap-2 border-t border-line bg-surface-2/60 px-4 py-2.5">
            <DocumentIcon size={12} className="mt-[3px] shrink-0 text-fg-3" />
            <p className="text-[11.5px] leading-relaxed text-fg-2">
              <span className="font-medium text-fg">{activeCase.title}</span>
              <span className="text-fg-3">
                {' '}
                · built to show {activeCase.expectation.toUpperCase()} — a preset, not a detection result.
              </span>
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <span
            className={`mono text-[11px] ${
              overLimit ? 'text-block' : text.length > limit * 0.9 ? 'text-review' : 'text-fg-3'
            }`}
          >
            {text.length.toLocaleString()} / {limit.toLocaleString()}
          </span>
          <span className="text-[11px] text-fg-3">{overLimit ? 'over the limit' : 'characters'}</span>

          <div className="ml-auto flex items-center gap-1.5">
            {onDismissEdit ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onDismissEdit}>
                Back to result
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClear}
              disabled={busy || text.length === 0}
            >
              Clear
            </button>
            {busy ? (
              <button type="button" className="btn btn-sm" onClick={onCancel}>
                <XIcon size={13} />
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onAnalyze}
              disabled={!canAnalyze}
              aria-busy={busy}
            >
              {busy ? <LoaderIcon size={14} className="animate-spin" /> : <ScanIcon size={14} />}
              {busy ? 'Screening…' : hasScreening ? 'Screen changes' : 'Screen content'}
              <kbd className="mono ml-0.5 hidden rounded border border-white/25 px-1 text-[10.5px] font-normal opacity-80 sm:inline">
                ⌘↵
              </kbd>
            </button>
          </div>
        </div>
      </div>

      {confirm ? (
        <ScreeningConfirm kind={confirm} busy={busy} onConfirm={onConfirm} onCancel={onCancelConfirm} className="mt-3" />
      ) : null}

      {changedSinceScreening && !confirm && !busy ? (
        <p className="mt-2.5 px-1 text-[11.5px] leading-relaxed text-fg-3" role="status">
          These edits have not been screened. Screening them produces a new result — the earlier decision describes the
          earlier text, not this draft.
        </p>
      ) : null}

      {busy ? <ScreeningProgress elapsed={elapsed} /> : null}

      {error ? (
        <div className="card mt-3 border-block-line bg-block-soft px-4 py-3" role="alert">
          <div className="flex items-start gap-2.5">
            <AlertIcon size={14} className="mt-0.5 shrink-0 text-block" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-fg">{error.title}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{error.detail}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">
                Nothing was released downstream. A failed screening is never treated as a pass.
              </p>
            </div>
            {error.retryable ? (
              <button type="button" className="btn btn-sm shrink-0" onClick={onAnalyze}>
                Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="mt-3 text-[12px] leading-relaxed text-fg-2" role="status">
          {notice}
        </p>
      ) : null}

      <div className="mt-7">
        <CasePicker cases={DEMO_CASES} activeId={activeCase?.id ?? null} onSelect={onSelectCase} />
      </div>

      {starter ? (
        <p className="mt-3 text-[11.5px] text-fg-3">
          New here?{' '}
          <button
            type="button"
            onClick={() => onRunCase(starter)}
            data-testid="try-blocked"
            className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
          >
            Screen the blocked example
          </button>{' '}
          — one click runs all three checks.
        </p>
      ) : null}

      {/* Reference material, not a first-screen requirement: closed by default,
          and the trail only exists once this session has actually screened
          something. */}
      <div className="mt-8 space-y-3">
        <DecisionPrimer />
        {audit.length > 0 ? <SessionTrail records={audit} /> : null}
        <p className="px-1 text-[11.5px] leading-relaxed text-fg-3">
          TrustRoute screens input. It never runs a script, sends a message or calls a downstream tool.
          {mode === 'live' ? ' This deployment is calling the Clocked API.' : ''}
        </p>
      </div>
    </div>
  );
}

function Results({
  screening,
  draft,
  mode,
  busy,
  elapsed,
  review,
  reviewBusy,
  notice,
  warnings,
  focus,
  setFocus,
  reveal,
  setReveal,
  audit,
  resultRef,
  confirm,
  onNewScreening,
  onEdit,
  onRecheck,
  onScreenChanges,
  onDiscardEdits,
  onConfirm,
  onCancelConfirm,
  onCancel,
  onApprove,
  onReject,
  onExport,
  onPrint,
}: {
  screening: Screening;
  draft: { text: string; contentType: ContentType };
  mode: 'live' | 'mock';
  busy: boolean;
  elapsed: number;
  review: ReviewEvent | null;
  reviewBusy: boolean;
  notice: string | null;
  warnings: string[];
  focus: { start: number; end: number; id: string } | null;
  setFocus: (value: { start: number; end: number; id: string }) => void;
  reveal: boolean;
  setReveal: (value: boolean) => void;
  audit: AuditRecord[];
  resultRef: React.RefObject<HTMLDivElement | null>;
  confirm: ConfirmKind | null;
  onNewScreening: () => void;
  onEdit: () => void;
  onRecheck: () => void;
  onScreenChanges: () => void;
  onDiscardEdits: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onCancel: () => void;
  onApprove: (note: string) => void;
  onReject: (note: string) => void;
  onExport: () => void;
  onPrint: () => void;
}) {
  // Everything below reads from the snapshot, never from the draft: the reader,
  // the highlight offsets, the evidence excerpts, the character count and the
  // export all describe the text that was actually screened.
  const { result, text, contentType } = screening;
  const unscreenedEdits = draft.text !== text || draft.contentType !== contentType;
  const effective = review?.decisionAfter ?? result.policy.decision;

  // Completion is stated once, in the stage header. The rows below show the
  // numbers; this line answers "did every check actually run?".
  const stages = [result.stages.guard, result.stages.protect, result.stages.inspect];
  const failedCount = stages.filter((item) => item.status !== 'ok' && item.status !== 'skipped').length;
  const skippedCount = stages.filter((item) => item.status === 'skipped').length;
  const okCount = stages.filter((item) => item.status === 'ok').length;
  const completion =
    failedCount > 0
      ? { failed: true, label: `${failedCount} of 3 did not complete` }
      : skippedCount > 0
        ? { failed: false, label: `${okCount} of 3 ran · ${skippedCount} not requested for this type` }
        : { failed: false, label: 'all three completed' };

  return (
    <div ref={resultRef} tabIndex={-1} data-testid="results" className="scroll-mt-20 space-y-3 outline-none">
      {unscreenedEdits ? (
        <section
          role="status"
          data-testid="unscreened-edits"
          className="card border-review-line bg-review-soft px-4 py-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertIcon size={14} className="mt-0.5 shrink-0 text-review" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-[#7a4d13]">
                Unscreened edits — the result below belongs to the earlier text
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-2">
                This decision was made for the {result.input.characters.toLocaleString()} characters screened at{' '}
                {clockTime(result.createdAt)}. Your draft now holds {draft.text.length.toLocaleString()} characters and
                has not been screened: nothing below describes it, and nothing from it was released.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={onScreenChanges}
                  disabled={busy || draft.text.trim().length === 0}
                >
                  <ScanIcon size={12} />
                  Screen changes
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscardEdits}>
                  Discard my edits
                </button>
              </div>
              {confirm === 'changes' ? (
                <ScreeningConfirm
                  kind="changes"
                  busy={busy}
                  onConfirm={onConfirm}
                  onCancel={onCancelConfirm}
                  className="mt-2"
                />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <ResultSummary
        result={result}
        review={review}
        busy={busy || reviewBusy}
        confirm={confirm}
        onNewScreening={onNewScreening}
        onEdit={onEdit}
        onRecheck={onRecheck}
        onConfirm={onConfirm}
        onCancelConfirm={onCancelConfirm}
        onExport={onExport}
        onPrint={onPrint}
      />

      {busy ? (
        <div className="flex items-center gap-2 px-1 text-[11.5px] text-fg-2" aria-live="polite">
          <LoaderIcon size={12} className="animate-spin text-accent" />
          Screening again · {(elapsed / 1000).toFixed(1)}s
          <button type="button" className="ml-auto text-accent underline underline-offset-2" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="px-1 text-[11.5px] leading-relaxed text-fg-2" role="status">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_324px]">
        {/* One column puts the reasoning directly under the source, so a phone
            reader reaches the action without scrolling past every passage. */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <ContentView
            result={result}
            text={text}
            focus={focus}
            blocked={effective === 'BLOCK'}
            onLocate={(span) =>
              setFocus({ start: span.start, end: span.end, id: `mask-${span.type}` })
            }
          />
        </div>

        <aside className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-[76px] lg:self-start">
          <InsightRail
            result={result}
            review={review}
            busy={busy || reviewBusy}
            onApprove={onApprove}
            onReject={onReject}
          />
        </aside>

        <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-start-2">
          <EvidencePanel
            result={result}
            text={text}
            focusId={focus?.id ?? null}
            onLocate={(row) => setFocus({ start: row.start, end: row.end, id: row.id })}
          />

          <section aria-label="Detection stages" className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1">
              <h2 className="text-[13px] font-semibold tracking-tight text-fg">Detection stages</h2>
              <span className={`text-[11.5px] ${completion.failed ? 'text-block' : 'text-fg-3'}`}>
                {completion.label}
              </span>
              <span className="ml-auto text-[11px] text-fg-3">
                {result.input.characters.toLocaleString()} chars · {CONTENT_TYPE_LABELS[contentType]}
              </span>
            </div>

            <div className="card divide-y divide-line overflow-hidden">
              <GuardCard stage={result.stages.guard} thresholds={result.policy.thresholds} />
              <ProtectCard
                stage={result.stages.protect}
                reveal={reveal}
                onToggleReveal={() => setReveal(!reveal)}
              />
              <InspectCard
                stage={result.stages.inspect}
                thresholds={result.policy.thresholds}
                sourceText={text}
              />
            </div>

            <p className="px-1 pt-1 text-[11px] leading-relaxed text-fg-3">{detectionFootnote(mode)}</p>

            {warnings.length > 0 ? (
              <ul className="space-y-1 px-1 pt-1">
                {warnings.map((warning) => (
                  <li key={warning} className="flex gap-2 text-[11px] leading-relaxed text-fg-3">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-3/70" aria-hidden="true" />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <details className="disclosure">
            <summary>
              <ChevronRightIcon size={12} className="chev text-fg-3" />
              Technical details
              <span className="ml-auto text-[11px] font-normal text-fg-3">
                endpoints, models, timing, credits
              </span>
            </summary>
            <TechnicalDetails result={result} />
          </details>

          {audit.length > 0 ? <SessionTrail records={audit} /> : null}
        </div>
      </div>
    </div>
  );
}

function TechnicalDetails({ result }: { result: AnalyzeResponse }) {
  const stages = [
    { name: 'Guard', stage: result.stages.guard },
    { name: 'Protect', stage: result.stages.protect },
    { name: 'Inspect', stage: result.stages.inspect },
  ];
  return (
    <div className="px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[11.5px] sm:grid-cols-4">
        <div>
          <dt className="text-fg-3">Run</dt>
          <dd className="mono mt-0.5 text-fg-2">{result.runId.slice(0, 12)}</dd>
        </div>
        <div>
          <dt className="text-fg-3">Input hash</dt>
          <dd className="mono mt-0.5 text-fg-2">{result.input.textHash.slice(0, 12)}…</dd>
        </div>
        <div>
          <dt className="text-fg-3">Words</dt>
          <dd className="mono mt-0.5 text-fg-2">{result.input.words.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-fg-3">Deployment policy</dt>
          <dd className="mt-0.5 text-fg-2">{result.input.instructionsApplied ? 'applied' : 'default'}</dd>
        </div>
      </dl>

      <div className="mt-3 overflow-hidden rounded-lg border border-line">
        <table className="w-full border-collapse text-left text-[11.5px]">
          <thead>
            <tr className="bg-surface-2 text-[10.5px] uppercase tracking-[0.06em] text-fg-3">
              <th className="px-2.5 py-1.5 font-semibold">Stage</th>
              <th className="px-2.5 py-1.5 font-semibold">Endpoint</th>
              <th className="px-2.5 py-1.5 font-semibold">Status</th>
              <th className="px-2.5 py-1.5 font-semibold">Attempts</th>
              <th className="px-2.5 py-1.5 font-semibold">Latency</th>
              <th className="px-2.5 py-1.5 font-semibold">Credits</th>
            </tr>
          </thead>
          <tbody>
            {stages.map(({ name, stage }) => (
              <tr key={name} className="border-t border-line">
                <td className="px-2.5 py-1.5 text-fg-2">{name}</td>
                <td className="mono px-2.5 py-1.5 text-fg-3">{stage.endpoint}</td>
                <td className="px-2.5 py-1.5 text-fg-2">{stage.status}</td>
                <td className="mono px-2.5 py-1.5 text-fg-2">{stage.attempts}</td>
                <td className="mono px-2.5 py-1.5 text-fg-2">{stage.latencyMs} ms</td>
                <td className="mono px-2.5 py-1.5 text-fg-3">{stage.credits ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-fg-3">
        Model identifiers and raw response envelopes are in the JSON report; the audit trail stores hashes, lengths and
        statuses only — never the content itself.
      </p>
    </div>
  );
}

function ScreeningProgress({ elapsed }: { elapsed: number }) {
  return (
    <div className="card mt-3 px-4 py-3" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2">
        <LoaderIcon size={13} className="animate-spin text-accent" />
        <span className="text-[12.5px] font-medium text-fg">Screening</span>
        <span className="mono ml-auto text-[11px] text-fg-3">{(elapsed / 1000).toFixed(1)}s</span>
      </div>
      <p className="mt-1.5 text-[11.5px] text-fg-3">
        Guard, Protect and Inspect run in parallel. A full screen usually takes a few seconds; cancel leaves nothing
        screened and nothing released.
      </p>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className={`${SHELL} flex flex-wrap items-center gap-x-4 gap-y-1.5 py-4 text-[11px] text-fg-3`}>
        <span>TrustRoute · Clocked Build Challenge 2026</span>
        <span className="hidden sm:inline">·</span>
        <span>Guard, Protect and Inspect are Clocked endpoints</span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <LockIcon size={11} />
          API key stays server-side
        </span>
      </div>
    </footer>
  );
}
