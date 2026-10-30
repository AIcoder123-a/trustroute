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
        requestsPerWindow: LIMITS.requestsPerWindow,
        windowMinutes: Math.round(LIMITS.windowMs / 60000),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
