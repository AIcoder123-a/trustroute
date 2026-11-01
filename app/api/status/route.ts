import { NextResponse } from 'next/server';

import { windowStore } from '@/lib/admission';
import { ABUSE, LIMITS, hasApiKey, resolveRunMode, turnstileState } from '@/lib/config';
import { quotaStore } from '@/lib/quota';

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
       * Published on purpose: the daily counter is the only ceiling that bounds
       * the credit balance, so an operator has to be able to see where it lives.
       * `redis` means the ceiling is shared by every instance and survives a
       * restart; `memory` means `instances × dailyScreens` and a cold start
       * resets it. Saying so here stops the limit being read as a promise it
       * cannot keep. See docs/SECURITY_NOTES.md §12.
       */
      admission: {
        store: quotaStore(),
        sharedAcrossInstances: quotaStore() === 'redis',
        /**
         * The per-caller window is a separate store with a separate meaning: it
         * bounds fairness, not spend. On a serverless host a `memory` window
         * counts for one invocation and stops there, so it is published even
         * when the quota beside it is shared.
         */
        window: {
          store: windowStore(),
          sharedAcrossInstances: windowStore() === 'redis',
        },
        /** `off` | `required` | `misconfigured` — the human-check gate. */
        turnstile: turnstileState(),
        /** Whether edge-written address headers are believed; false on a direct-to-origin deploy. */
        trustProxy: ABUSE.trustProxy,
        /** `netlify` when the deployment declared it, which enables that host's client-IP header. */
        platform: (process.env.PLATFORM ?? '').trim().toLowerCase() || null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
