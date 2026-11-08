/**
 * Visitor bucket for the audit trail.
 *
 * The trail is a convenience feature, and the review note attached to a record
 * is free text a reviewer typed. Serving that to every other visitor would make
 * one person's note another person's reading material, so each browser gets an
 * opaque id and only sees the records it produced.
 *
 * This is not authentication and must not be described as one: anyone who can
 * reach the endpoint can mint a fresh bucket by clearing the cookie, and the
 * ids carry no identity. It bounds the blast radius of the in-memory trail; it
 * does not make the trail private in the way an account system would.
 */

import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'tr_session';

/** Two weeks: long enough that a judging session keeps its own history. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Read the caller's bucket, without ever minting one.
 *
 * Only `/api/analyze` issues a bucket: if the trail endpoint could also issue
 * one, a first visit that fires the trail read and a screening at the same time
 * would race, and the screening's record could be stamped with the id that lost.
 * Everything else reads.
 */
export async function readSession(): Promise<string | null> {
  try {
    const jar = await cookies();
    const existing = jar.get(SESSION_COOKIE)?.value;
    return existing && SHAPE.test(existing) ? existing : null;
  } catch {
    return null;
  }
}

/**
 * Read the caller's bucket, issuing one on first use.
 *
 * Only route handlers call this: a Server Component cannot set a cookie, and
 * nothing here is needed during render.
 */
export async function ensureSession(): Promise<string> {
  let jar: Awaited<ReturnType<typeof cookies>>;
  try {
    jar = await cookies();
  } catch {
    // No request scope: a unit test calling the handler directly, or a future
    // non-HTTP caller. A throwaway bucket is correct there — the record is
    // still written, it simply belongs to nobody who can read it back.
    return randomUUID();
  }

  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing && SHAPE.test(existing)) return existing;

  const id = randomUUID();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return id;
}
