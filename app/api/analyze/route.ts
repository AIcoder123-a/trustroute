import { NextResponse } from 'next/server';

import { admit, release } from '@/lib/admission';
import { ConfigurationError, LIMITS, hasApiKey, turnstileState } from '@/lib/config';
import { checkOrigin } from '@/lib/origin';
import { analyze } from '@/lib/pipeline';
import { callerIdentity } from '@/lib/ratelimit';
import { verifyTurnstile } from '@/lib/turnstile';
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

/**
 * The Turnstile gate, when it is on.
 *
 * `disabled` is a pass-through so a deployment without a site key behaves as it
 * did before. Everything else is a refusal:
 *
 *   - missing / replayed / rejected → `403 challenge_required`, which is what the
 *     widget's callback needs to see;
 *   - verifier unreachable, or the gate switched on without a secret → `503`,
 *     because "we could not check" must not become "we assume it was fine".
 */
async function turnstileGate(request: Request, remoteIp: string | null): Promise<NextResponse | null> {
  if (turnstileState() === 'off') return null;

  const result = await verifyTurnstile(request.headers.get('x-turnstile-token'), { remoteIp });

  if (result.ok) return null;

  if (result.reason === 'verifier_unavailable' || result.reason === 'misconfigured') {
    return NextResponse.json(
      {
        error: 'verification_unavailable',
        message:
          'The human-check could not be completed, so nothing was screened. This is a deliberate refusal, not a credential problem.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
    );
  }

  return NextResponse.json(
    {
      error: 'challenge_required',
      message:
        result.reason === 'replayed'
          ? 'That human-check token has already been used. Complete the check again.'
          : 'A completed human-check is required before screening. Nothing was sent to the API.',
    },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
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

  const identity = callerIdentity(request);

  // Before any counter: a caller without a valid human-check token must not be
  // able to spend the deployment's window, let alone its credits.
  const challenge = await turnstileGate(request, identity.ip);
  if (challenge) return challenge;

  const admission = await admit(identity.key);
  if (!admission.allowed) {
    if (admission.reason === 'quota_unavailable') {
      return NextResponse.json(
        {
          error: 'quota_unavailable',
          message:
            'The screening budget could not be checked, so nothing was screened. This is a deliberate refusal: an unknown budget is treated as no budget.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
      );
    }
    return rateLimited(admission.reason ?? 'window', admission.retryAfterSeconds, admission.dailyRemaining);
  }
  const key = identity.key;

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
