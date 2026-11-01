import { NextResponse } from 'next/server';

import { LIMITS, hasApiKey, resolveRunMode } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Publishes only what the browser needs to label the run: which transport is
 * active and what the input limits are. Never the key, never a prefix of it.
 */
export async function GET() {
  let mode: 'live' | 'mock' = 'mock';
  let error: string | null = null;
  try {
    mode = resolveRunMode();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Configuration error';
  }

  return NextResponse.json(
    {
      mode,
      configuredKey: hasApiKey(),
      error,
      limits: {
        proseCharacters: LIMITS.proseCharacters,
        scriptCharacters: LIMITS.scriptCharacters,
        maxBodyBytes: LIMITS.maxBodyBytes,
        requestsPerWindow: LIMITS.requestsPerWindow,
        windowMinutes: Math.round(LIMITS.windowMs / 60000),
        dailyScreens: LIMITS.dailyScreens,
        concurrentPerCaller: LIMITS.concurrentPerCaller,
      },
      /**
       * Published on purpose: the counters live in this process. On one instance
       * the daily ceiling is exact; on a host that runs several it is
       * `instances × dailyScreens`, and a cold start resets it. Saying so here
       * stops an operator from reading the limit as a deployment-wide promise.
       * See docs/SECURITY_NOTES.md §12 and docs/DEPLOYMENT.md §5.2.
       */
      admission: {
        store: 'in-memory',
        sharedAcrossInstances: false,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
