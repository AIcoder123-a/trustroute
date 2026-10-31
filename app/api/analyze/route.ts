import { NextResponse } from 'next/server';

import { admit, release } from '@/lib/admission';
import { ConfigurationError, LIMITS, hasApiKey } from '@/lib/config';
import { checkOrigin } from '@/lib/origin';
import { analyze } from '@/lib/pipeline';
import { callerKey } from '@/lib/ratelimit';
import { validateAnalyzeInput } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Never forwarded: the browser only needs to know what to do next. */
function rateLimited(reason: string, retryAfterSeconds: number, dailyRemaining: number) {
  const message =
    reason === 'daily_budget'
      ? 'This demo has used its screening allowance for today. Nothing was screened; the workflow is still visible with a demo case loaded.'
      : reason === 'concurrency'
        ? 'Another screening from this browser is still running. Wait for it to finish — nothing was screened twice.'
        : `Too many screening requests. Try again in ${retryAfterSeconds}s.`;
  return NextResponse.json(
    { error: 'rate_limited', message },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'Cache-Control': 'no-store',
        'X-Daily-Remaining': String(dailyRemaining),
      },
    },
  );
}

export async function POST(request: Request) {
  const origin = checkOrigin(request);
  if (!origin.ok) {
    return NextResponse.json(
      {
        error: 'cross_origin_blocked',
        message: 'This endpoint only accepts requests from the application itself.',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // A body cap before parsing: the route is public, and `request.json()` on an
  // unbounded body is a memory amplifier.
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) {
    return NextResponse.json(
      { error: 'payload_too_large', message: 'Request body is larger than this demo accepts.' },
      { status: 413, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const key = callerKey(request);
  const admission = admit(key);
  if (!admission.allowed) {
    return rateLimited(admission.reason ?? 'window', admission.retryAfterSeconds, admission.dailyRemaining);
  }

  try {
    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return NextResponse.json(
        { error: 'unreadable_body', message: 'Request body could not be read.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (raw.length > LIMITS.maxBodyBytes) {
      return NextResponse.json(
        { error: 'payload_too_large', message: 'Request body is larger than this demo accepts.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: 'invalid_json', message: 'Request body must be valid JSON.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const validated = validateAnalyzeInput(body);
    if (!validated.ok) {
      return NextResponse.json(
        { error: 'invalid_input', message: validated.message },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const result = await analyze(validated.value);
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-RateLimit-Limit': String(admission.limit),
        'X-RateLimit-Remaining': String(admission.remaining),
        'X-Daily-Remaining': String(admission.dailyRemaining),
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
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    // Deliberately generic: an internal message can name a host, a header or a
    // stack frame, and this response is public.
    return NextResponse.json(
      {
        error: 'pipeline_failure',
        message:
          'TrustRoute could not complete this screening. Nothing was released. Try again, and if it repeats the deployment needs attention.',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    release(key);
  }
}
