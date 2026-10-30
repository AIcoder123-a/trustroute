/**
 * Inspection gateway: one entry point per detection, whichever transport is
 * active. The rest of the application never branches on mock vs live — it reads
 * `StageResult.mode`, which the UI surfaces prominently.
 */

import type { ContentType, GuardData, InspectData, ProtectData, RunMode, StageResult } from '../types';
import { liveGuard, liveInspect, liveProtect, classifyError, type StageCall } from './live';
import { mockGuard, mockInspect, mockProtect } from './mock';

export const ENDPOINTS = {
  guard: 'POST /injection',
  protect: 'POST /pii',
  inspect: 'POST /script',
} as const;

/** Total budget for a single stage, including the SDK's own retries. */
const STAGE_BUDGET_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockLatency(text: string): number {
  // A stable pseudo-latency derived from the content so the loading states are
  // exercised without making the demo feel random.
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 9973;
  }
  return 180 + (hash % 320);
}

async function finish<T>(
  kind: StageResult<T>['kind'],
  mode: RunMode,
  startedAt: number,
  call: Promise<StageCall<T>>,
): Promise<StageResult<T>> {
  const result = await call;
  return {
    kind,
    status: result.status,
    mode,
    latencyMs: Math.round(performance.now() - startedAt),
    attempts: result.attempts,
    data: result.data,
    error: result.error,
    credits: result.credits,
    endpoint: ENDPOINTS[kind],
  };
}

function failed<T>(kind: StageResult<T>['kind'], mode: RunMode, startedAt: number, error: unknown): StageResult<T> {
  const { status, error: stageError } = classifyError(error);
  return {
    kind,
    status,
    mode,
    latencyMs: Math.round(performance.now() - startedAt),
    attempts: 1,
    data: null,
    error: stageError,
    credits: null,
    endpoint: ENDPOINTS[kind],
  };
}

export async function runGuard(
  text: string,
  contentType: ContentType,
  instructions: string | null,
  mode: RunMode,
): Promise<StageResult<GuardData>> {
  const startedAt = performance.now();
  if (mode === 'mock') {
    await sleep(mockLatency(text));
    const data = mockGuard(text, contentType);
    return {
      kind: 'guard',
      status: 'ok',
      mode,
      latencyMs: Math.round(performance.now() - startedAt),
      attempts: 1,
      data,
      error: null,
      credits: null,
      endpoint: ENDPOINTS.guard,
    };
  }
  return finish('guard', mode, startedAt, liveGuard(text, instructions, AbortSignal.timeout(STAGE_BUDGET_MS)));
}

export async function runProtect(text: string, mode: RunMode): Promise<StageResult<ProtectData>> {
  const startedAt = performance.now();
  if (mode === 'mock') {
    await sleep(mockLatency(text));
    return {
      kind: 'protect',
      status: 'ok',
      mode,
      latencyMs: Math.round(performance.now() - startedAt),
      attempts: 1,
      data: mockProtect(text),
      error: null,
      credits: null,
      endpoint: ENDPOINTS.protect,
    };
  }
  return finish('protect', mode, startedAt, liveProtect(text, AbortSignal.timeout(STAGE_BUDGET_MS)));
}

export async function runInspect(
  script: string,
  instructions: string | null,
  mode: RunMode,
): Promise<StageResult<InspectData>> {
  const startedAt = performance.now();
  if (mode === 'mock') {
    await sleep(mockLatency(script));
    return {
      kind: 'inspect',
      status: 'ok',
      mode,
      latencyMs: Math.round(performance.now() - startedAt),
      attempts: 1,
      data: mockInspect(script),
      error: null,
      credits: null,
      endpoint: ENDPOINTS.inspect,
    };
  }
  return finish('inspect', mode, startedAt, liveInspect(script, instructions, AbortSignal.timeout(STAGE_BUDGET_MS)));
}

/** A detection that was deliberately not requested for this content type. */
export function skippedStage<T>(
  kind: StageResult<T>['kind'],
  mode: RunMode,
  reason: string,
): StageResult<T> {
  return {
    kind,
    status: 'skipped',
    mode,
    latencyMs: 0,
    attempts: 0,
    data: null,
    error: {
      code: 'not_requested',
      message: reason,
      retryable: false,
      httpStatus: null,
    },
    credits: null,
    endpoint: ENDPOINTS[kind],
  };
}

export { failed };
