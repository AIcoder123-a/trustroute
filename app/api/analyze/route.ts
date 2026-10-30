import { NextResponse } from 'next/server';

import { ConfigurationError, LIMITS, hasApiKey } from '@/lib/config';
import { analyze } from '@/lib/pipeline';
import { callerKey, checkRateLimit } from '@/lib/ratelimit';
import { validateAnalyzeInput } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  const limit = checkRateLimit(callerKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `Too many screening requests. Try again in ${limit.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const validated = validateAnalyzeInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: 'invalid_input', message: validated.message }, { status: 400 });
  }

  try {
    const result = await analyze(validated.value);
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-RateLimit-Limit': String(limit.limit),
        'X-RateLimit-Remaining': String(limit.remaining),
      },
    });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return NextResponse.json(
        {
          error: 'not_configured',
          message: error.message,
          hint: hasApiKey()
            ? 'Check CLOCKED_MODE in your environment.'
            : 'Set CLOCKED_API_KEY to screen real content, or CLOCKED_MODE=mock to run the labelled simulator.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: 'pipeline_failure',
        message:
          error instanceof Error
            ? `TrustRoute could not complete screening: ${error.message}`
            : 'TrustRoute could not complete screening.',
        limits: { prose: LIMITS.proseCharacters, script: LIMITS.scriptCharacters },
      },
      { status: 500 },
    );
  }
}
