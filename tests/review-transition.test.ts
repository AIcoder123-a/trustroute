import { describe, expect, it } from 'vitest';

import { approvalBlockedReason, canApprove, planReview } from '@/lib/review';
import type { Decision, ReviewAction, ScreeningState } from '@/lib/types';

/**
 * The table below is the security contract. Each row is a request somebody can
 * actually make — from the page, or from curl against the route — and the
 * outcome it is allowed to reach.
 */
interface Row {
  name: string;
  action: ReviewAction;
  policy: Decision;
  screening?: ScreeningState;
  requested: Decision;
  reviewed?: boolean;
  expect: 'PASS' | 'BLOCK' | 'REVIEW' | 'refused';
  code?: string;
}

const rows: Row[] = [
  {
    name: 'a block cannot be approved into a pass',
    action: 'approve',
    policy: 'BLOCK',
    requested: 'PASS',
    expect: 'refused',
    code: 'blocked_not_reviewable',
  },
  {
    name: 'a block cannot be rejected (it is already the strongest state)',
    action: 'reject',
    policy: 'BLOCK',
    requested: 'BLOCK',
    expect: 'refused',
    code: 'blocked_not_reviewable',
  },
  {
    name: 'an incomplete screen cannot be approved, even as a REVIEW',
    action: 'approve',
    policy: 'REVIEW',
    screening: 'unavailable',
    requested: 'PASS',
    expect: 'refused',
    code: 'screening_incomplete',
  },
  {
    name: 'an incomplete screen cannot be approved by claiming PASS',
    action: 'approve',
    policy: 'REVIEW',
    screening: 'unavailable',
    requested: 'BLOCK',
    expect: 'refused',
    code: 'screening_incomplete',
  },
  {
    name: 'a complete review is approved to PASS',
    action: 'approve',
    policy: 'REVIEW',
    screening: 'complete',
    requested: 'PASS',
    expect: 'PASS',
  },
  {
    name: 'approving a review cannot land on BLOCK by request',
    action: 'approve',
    policy: 'REVIEW',
    screening: 'complete',
    requested: 'BLOCK',
    expect: 'refused',
    code: 'decision_after_mismatch',
  },
  {
    name: 'a complete review can be rejected to BLOCK',
    action: 'reject',
    policy: 'REVIEW',
    screening: 'complete',
    requested: 'BLOCK',
    expect: 'BLOCK',
  },
  {
    name: 'an incomplete screen can be rejected — that fails closed',
    action: 'reject',
    policy: 'REVIEW',
    screening: 'unavailable',
    requested: 'BLOCK',
    expect: 'BLOCK',
  },
  {
    name: 'rejecting a review cannot claim PASS',
    action: 'reject',
    policy: 'REVIEW',
    screening: 'complete',
    requested: 'PASS',
    expect: 'refused',
    code: 'decision_after_mismatch',
  },
  {
    name: 'a pass has nothing to approve',
    action: 'approve',
    policy: 'PASS',
    screening: 'complete',
    requested: 'PASS',
    expect: 'refused',
    code: 'not_reviewable',
  },
  {
    name: 'a pass can still be rejected by a human',
    action: 'reject',
    policy: 'PASS',
    screening: 'complete',
    requested: 'BLOCK',
    expect: 'BLOCK',
  },
  {
    name: 'a recheck records the screen request without moving the decision',
    action: 'recheck',
    policy: 'REVIEW',
    screening: 'complete',
    requested: 'REVIEW',
    expect: 'REVIEW',
  },
  {
    name: 'a recheck cannot be used as a disguised approval',
    action: 'recheck',
    policy: 'BLOCK',
    requested: 'PASS',
    expect: 'refused',
    code: 'decision_after_mismatch',
  },
  {
    name: 'a second review of the same run is refused',
    action: 'approve',
    policy: 'REVIEW',
    screening: 'complete',
    requested: 'PASS',
    reviewed: true,
    expect: 'refused',
    code: 'already_reviewed',
  },
  {
    name: 'a reviewed block cannot be re-reviewed into a pass',
    action: 'approve',
    policy: 'BLOCK',
    requested: 'PASS',
    reviewed: true,
    expect: 'refused',
    code: 'already_reviewed',
  },
];

describe('review transitions', () => {
  for (const row of rows) {
    it(row.name, () => {
      const plan = planReview({
        action: row.action,
        policyDecision: row.policy,
        screening: row.screening ?? 'complete',
        requestedAfter: row.requested,
        alreadyReviewed: row.reviewed ?? false,
      });

      if (row.expect === 'refused') {
        expect(plan.ok).toBe(false);
        if (!plan.ok) expect(plan.code).toBe(row.code);
        return;
      }

      expect(plan.ok).toBe(true);
      if (plan.ok) expect(plan.decisionAfter).toBe(row.expect);
    });
  }

  it('never returns PASS for a policy block, whatever the action', () => {
    for (const action of ['approve', 'reject', 'recheck'] as ReviewAction[]) {
      for (const requested of ['PASS', 'REVIEW', 'BLOCK'] as Decision[]) {
        const plan = planReview({
          action,
          policyDecision: 'BLOCK',
          screening: 'complete',
          requestedAfter: requested,
          alreadyReviewed: false,
        });
        expect(plan.ok && plan.decisionAfter === 'PASS', `${action} → ${requested}`).toBe(false);
      }
    }
  });

  it('never returns PASS for an incomplete screen, whatever the action', () => {
    for (const action of ['approve', 'reject', 'recheck'] as ReviewAction[]) {
      for (const requested of ['PASS', 'REVIEW', 'BLOCK'] as Decision[]) {
        const plan = planReview({
          action,
          policyDecision: 'REVIEW',
          screening: 'unavailable',
          requestedAfter: requested,
          alreadyReviewed: false,
        });
        expect(plan.ok && plan.decisionAfter === 'PASS', `${action} → ${requested}`).toBe(false);
      }
    }
  });
});

describe('the checkpoint offers approval only for a complete review', () => {
  it('matches the transition table', () => {
    expect(canApprove('REVIEW', 'complete')).toBe(true);
    expect(canApprove('REVIEW', 'unavailable')).toBe(false);
    expect(canApprove('BLOCK', 'complete')).toBe(false);
    expect(canApprove('BLOCK', 'unavailable')).toBe(false);
    expect(canApprove('PASS', 'complete')).toBe(false);
  });

  it('explains every state where approval is unavailable', () => {
    for (const [policy, screening] of [
      ['BLOCK', 'complete'],
      ['BLOCK', 'unavailable'],
      ['REVIEW', 'unavailable'],
      ['PASS', 'complete'],
    ] as const) {
      expect(approvalBlockedReason(policy, screening), `${policy}/${screening}`).toBeTruthy();
    }
    expect(approvalBlockedReason('REVIEW', 'complete')).toBeNull();
  });

  it('says nothing about forwarding when a block blocks approval', () => {
    const reason = approvalBlockedReason('BLOCK', 'complete') ?? '';
    expect(reason.toLowerCase()).not.toContain('forward');
    expect(reason.toLowerCase()).not.toContain('may');
  });
});
