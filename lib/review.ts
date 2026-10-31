/**
 * Review-note contract, shared by the browser and the route handler so the two
 * cannot disagree about what is acceptable.
 *
 * Why a rejection needs a note at all: approving is recorded by the decision
 * itself, but "why did a human override the gateway" is the question an auditor
 * asks later, and an empty box answers it with silence. The threshold is low on
 * purpose — it asks for a reason, not an essay.
 */

import type { ReviewAction } from './types';

export const REVIEW_NOTE_MAX = 280;
export const MIN_REJECT_NOTE = 8;

export function normalizeNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, REVIEW_NOTE_MAX) : null;
}

export function noteSatisfiesAction(action: ReviewAction, note: string | null): boolean {
  if (action !== 'reject') return true;
  return (note?.trim().length ?? 0) >= MIN_REJECT_NOTE;
}
