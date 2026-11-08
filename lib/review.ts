/**
 * Review-transition contract, shared by the browser and the route handler.
 *
 * This is the security boundary expressed as a pure function. The rules are
 * deliberately narrow, because a review exists to resolve a REVIEW — not to
 * dissolve a block:
 *
 *   - a policy BLOCK is final. No approval path, from any caller, turns it
 *     into something that may leave the gateway;
 *   - a run whose required detections did not complete has no verdict to
 *     approve, so it cannot be approved either;
 *   - only a complete REVIEW can be approved, and only a human rejection can
 *     produce a BLOCK from a REVIEW or a PASS (a rejection fails closed, so
 *     allowing it can only tighten the outcome);
 *   - a recheck records that a new screen was asked for; it changes nothing.
 *
 * The route feeds this function the server's own record of the run. The browser
 * calls it before it sends anything so the two cannot drift — but the browser's
 * answer is a courtesy, never the authority.
 */

import type { Decision, ReviewAction, ScreeningState } from './types';

export const REVIEW_NOTE_MAX = 280;
export const MIN_REJECT_NOTE = 8;

export type ReviewRefusalCode =
  | 'unknown_run'
  | 'already_reviewed'
  | 'decision_before_mismatch'
  | 'blocked_not_reviewable'
  | 'screening_incomplete'
  | 'not_reviewable'
  | 'decision_after_mismatch';

export type ReviewPlan =
  | { ok: true; decisionAfter: Decision }
  | { ok: false; code: ReviewRefusalCode; message: string };

export interface ReviewFacts {
  action: ReviewAction;
  /** The policy engine's verdict, as recorded server-side. */
  policyDecision: Decision;
  /** Whether every required detection completed, as recorded server-side. */
  screening: ScreeningState;
  /** What the caller asked the outcome to become. Checked, never trusted. */
  requestedAfter: Decision;
  /** A review already recorded for this run is not rewritten. */
  alreadyReviewed: boolean;
}

function refuse(code: ReviewRefusalCode, message: string): ReviewPlan {
  return { ok: false, code, message };
}

/**
 * Resolve — or refuse — one review action.
 *
 * Returns the only outcome this run is allowed to reach. A caller that asks for
 * a different one is refused rather than silently corrected: a silent
 * correction would let a client believe it had changed a verdict it had not.
 */
export function planReview(facts: ReviewFacts): ReviewPlan {
  const { action, policyDecision, screening, requestedAfter, alreadyReviewed } = facts;

  if (alreadyReviewed) {
    return refuse('already_reviewed', 'A review has already been recorded for this run. The first decision stands.');
  }

  if (action === 'recheck') {
    if (requestedAfter !== policyDecision) {
      return refuse('decision_after_mismatch', 'A recheck records a new screen request; it cannot move the decision.');
    }
    return { ok: true, decisionAfter: policyDecision };
  }

  if (action === 'approve') {
    if (policyDecision === 'BLOCK') {
      return refuse(
        'blocked_not_reviewable',
        'Policy blocked this content. A block is final at this gateway: it cannot be approved into a pass.',
      );
    }
    if (screening === 'unavailable') {
      return refuse(
        'screening_incomplete',
        'A required detection did not complete. There is no verdict to approve — re-run the screen instead.',
      );
    }
    if (policyDecision !== 'REVIEW') {
      return refuse('not_reviewable', 'Only a REVIEW is waiting on a human. This run needed no approval.');
    }
    if (requestedAfter !== 'PASS') {
      return refuse('decision_after_mismatch', 'Approving a review moves it to PASS, and only to PASS.');
    }
    return { ok: true, decisionAfter: 'PASS' };
  }

  // action === 'reject': the only direction a human may still take, and it can
  // only tighten the outcome. A block is already the strongest state.
  if (policyDecision === 'BLOCK') {
    return refuse('blocked_not_reviewable', 'This content is already blocked. Rejecting changes nothing.');
  }
  if (requestedAfter !== 'BLOCK') {
    return refuse('decision_after_mismatch', 'Rejecting moves the decision to BLOCK, and only to BLOCK.');
  }
  return { ok: true, decisionAfter: 'BLOCK' };
}

/** Whether the checkpoint offers an approval at all, given the recorded facts. */
export function canApprove(policyDecision: Decision, screening: ScreeningState): boolean {
  return policyDecision === 'REVIEW' && screening === 'complete';
}

/**
 * Why approval is unavailable, in the words the checkpoint shows. Kept next to
 * `canApprove` so the button state and the explanation cannot disagree.
 */
export function approvalBlockedReason(policyDecision: Decision, screening: ScreeningState): string | null {
  if (canApprove(policyDecision, screening)) return null;
  if (policyDecision === 'BLOCK') return 'Blocked by policy. A block is final here — there is nothing to approve.';
  if (screening === 'unavailable') return 'Screening did not complete, so there is no verdict to approve.';
  if (policyDecision === 'PASS') return 'Nothing to approve: policy already passed this content.';
  return 'This run is not waiting on a human.';
}

export function normalizeNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, REVIEW_NOTE_MAX) : null;
}

export function noteSatisfiesAction(action: ReviewAction, note: string | null): boolean {
  if (action !== 'reject') return true;
  return (note?.trim().length ?? 0) >= MIN_REJECT_NOTE;
}
