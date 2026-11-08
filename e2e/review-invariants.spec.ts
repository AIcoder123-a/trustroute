import { expect, test, type Page } from '@playwright/test';

import { readFileSync } from 'node:fs';

import type { AnalyzeResponse } from '@/lib/types';

const BLOCK_CASE = 'Classic prompt injection';
const REVIEW_CASE = 'Script needing review';
const PASS_CASE = 'Routine support ticket';

async function screen(page: Page, title: string) {
  await page.goto('/');
  const card = page.locator('[data-testid="case-list"] button', { hasText: title });
  if ((await card.count()) === 0) {
    await page.getByRole('button', { name: /More examples/ }).click();
  }
  await page.locator('[data-testid="case-list"] button', { hasText: title }).first().click();
  await page.getByRole('button', { name: /Screen content/ }).click();
  await expect(page.getByTestId('decision-badge')).toBeVisible();
  await page.waitForTimeout(400);
}

async function runIdOf(page: Page): Promise<string> {
  const body = await page.evaluate(async () => (await fetch('/api/audit')).json());
  return body.records[0].runId as string;
}

async function postReview(page: Page, payload: Record<string, unknown>) {
  return page.evaluate(async (body) => {
    const response = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, payload);
}

async function exportJson(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /JSON report/ }).click(),
  ]);
  const path = await download.path();
  return JSON.parse(readFileSync(path, 'utf8')) as {
    decision: { decision: string; effectiveDecision: string; headline: string };
    review: { action: string; decisionBefore: string; decisionAfter: string; note: string | null } | null;
    disclaimers: string[];
  };
}

/** Fail Protect, the way the policy engine does when a detector returns nothing. */
async function makeProtectFail(page: Page) {
  await page.route('**/api/analyze', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as AnalyzeResponse;
    body.stages.protect = {
      ...body.stages.protect,
      status: 'quota',
      data: null,
      credits: null,
      error: { code: 'insufficient_credits', message: 'Out of credits.', retryable: false, httpStatus: 402 },
    };
    body.redaction = {
      maskedText: null,
      applied: [],
      dropped: [],
      rejected: [],
      apiComparison: 'absent',
      totalEntities: 0,
    };
    body.policy = {
      ...body.policy,
      decision: 'REVIEW',
      screening: 'unavailable',
      degraded: true,
      headline: 'Screening unavailable — manual review required.',
      requiresHumanReview: true,
      canForwardMasked: false,
    };
    await route.fulfill({ response, json: body });
  });
}

test.describe('review invariants', () => {
  test('a blocked run offers no approval at all', async ({ page }) => {
    const reviewCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/review')) reviewCalls.push(request.postData() ?? '');
    });

    await screen(page, BLOCK_CASE);
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);

    const checkpoint = page.locator('#checkpoint');
    await expect(checkpoint.getByText('Blocked by policy · no approval available')).toBeVisible();
    await expect(checkpoint.getByRole('button', { name: /Approve/ })).toHaveCount(0);
    await expect(checkpoint.getByRole('button', { name: /Reject/ })).toHaveCount(0);
    await expect(checkpoint.getByLabel('Reviewer note')).toHaveCount(0);

    // The old defect was one click away; make sure nothing on the card is.
    await checkpoint.getByText('Blocked by policy · no approval available').click();
    await page.waitForTimeout(300);
    expect(reviewCalls).toHaveLength(0);
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);
    await expect(page.getByText(/may now be forwarded|would now be released/i)).toHaveCount(0);
  });

  test('an incomplete screen cannot be approved', async ({ page }) => {
    const reviewCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/review')) reviewCalls.push(request.postData() ?? '');
    });

    await makeProtectFail(page);
    await screen(page, PASS_CASE);

    await expect(page.getByTestId('decision-badge')).toHaveText(/Unavailable/i);
    const approve = page.locator('#checkpoint').getByRole('button', { name: /Approve/ });
    await expect(approve).toBeDisabled();
    await expect(page.getByTestId('approval-blocked-reason')).toContainText(/did not complete/i);

    await approve.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect(reviewCalls).toHaveLength(0);
    await expect(page.getByTestId('decision-badge')).toHaveText(/Unavailable/i);
  });

  test('a review is approved, and every surface keeps both decisions', async ({ page }) => {
    await screen(page, REVIEW_CASE);
    await expect(page.getByTestId('decision-badge')).toHaveText(/REVIEW/);

    const runId = await runIdOf(page);
    await page.locator('#checkpoint').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId('decision-badge')).toHaveText(/PASS/);
    await expect(page.getByText(/reviewer override · policy said REVIEW/)).toBeVisible();
    await expect(page.getByText(/Approval recorded/)).toBeVisible();

    const report = await exportJson(page);
    // The policy verdict survives the review; the review is recorded beside it.
    expect(report.decision.decision).toBe('REVIEW');
    expect(report.decision.effectiveDecision).toBe('PASS');
    expect(report.review).toMatchObject({ action: 'approve', decisionBefore: 'REVIEW', decisionAfter: 'PASS' });

    const audit = await page.evaluate(async () => (await fetch('/api/audit')).json());
    expect(audit.records[0]).toMatchObject({ runId, decision: 'REVIEW' });
    expect(audit.records[0].review.action).toBe('approve');
    await expect(page.getByText(/reviewed → PASS/)).toBeVisible();

    await page.getByRole('button', { name: /Review sheet/ }).click();
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/policy said REVIEW · reviewer moved it to PASS/)).toBeVisible();
    await expect(sheet.getByText(/Decision moved from REVIEW to PASS/)).toBeVisible();
  });

  test('a review is rejected, and the sheet does not claim a copy would be forwarded', async ({ page }) => {
    await screen(page, REVIEW_CASE);
    await page.locator('#checkpoint').getByLabel('Reviewer note').fill('Script deletes logs without a path.');
    await page.locator('#checkpoint').getByRole('button', { name: 'Reject' }).click();

    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);
    await expect(page.getByText(/Rejected by a reviewer/)).toBeVisible();

    const report = await exportJson(page);
    expect(report.decision.decision).toBe('REVIEW');
    expect(report.decision.effectiveDecision).toBe('BLOCK');
    expect(report.review).toMatchObject({ action: 'reject', decisionAfter: 'BLOCK' });

    await page.getByRole('button', { name: /Review sheet/ }).click();
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet.getByText(/policy said REVIEW · reviewer moved it to BLOCK/)).toBeVisible();
    await expect(sheet.getByText(/Copy that would be forwarded/)).toHaveCount(0);
  });

  test('a forged approval of a block is refused, and nothing changes on the page', async ({ page }) => {
    await screen(page, BLOCK_CASE);
    const runId = await runIdOf(page);

    const forged = await postReview(page, {
      runId,
      action: 'approve',
      decisionBefore: 'BLOCK',
      decisionAfter: 'PASS',
      note: null,
    });

    expect(forged.status).toBe(403);
    expect(forged.body.error).toBe('blocked_not_reviewable');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);

    const audit = await page.evaluate(async () => (await fetch('/api/audit')).json());
    expect(audit.records[0].review).toBeNull();
  });

  test('claiming the block was a REVIEW does not make it one', async ({ page }) => {
    await screen(page, BLOCK_CASE);
    const runId = await runIdOf(page);

    const forged = await postReview(page, {
      runId,
      action: 'approve',
      decisionBefore: 'REVIEW',
      decisionAfter: 'PASS',
      note: null,
    });

    expect(forged.status).toBe(409);
    expect(forged.body.error).toBe('decision_before_mismatch');

    const audit = await page.evaluate(async () => (await fetch('/api/audit')).json());
    expect(audit.records[0].decision).toBe('BLOCK');
    expect(audit.records[0].review).toBeNull();
  });

  test('an action cannot claim an outcome it does not produce', async ({ page }) => {
    await screen(page, REVIEW_CASE);
    const runId = await runIdOf(page);

    const mismatch = await postReview(page, {
      runId,
      action: 'approve',
      decisionBefore: 'REVIEW',
      decisionAfter: 'BLOCK',
      note: 'trying to smuggle a different outcome',
    });

    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error).toBe('decision_after_mismatch');
    await expect(page.getByTestId('decision-badge')).toHaveText(/REVIEW/);
  });

  test('a second browser can neither read nor review this run', async ({ browser, page }) => {
    await screen(page, REVIEW_CASE);
    await page.locator('#checkpoint').getByLabel('Reviewer note').fill('NOTE-SHOULD-NOT-LEAK-4f21');
    await page.locator('#checkpoint').getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);
    const runId = await runIdOf(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto('/');

    const theirs = await otherPage.evaluate(async () => (await fetch('/api/audit')).json());
    expect(theirs.records).toHaveLength(0);
    expect(JSON.stringify(theirs)).not.toContain('NOTE-SHOULD-NOT-LEAK');
    expect(JSON.stringify(theirs)).not.toContain(runId);

    const attempt = await otherPage.evaluate(async (id) => {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: id,
          action: 'reject',
          decisionBefore: 'REVIEW',
          decisionAfter: 'BLOCK',
          note: 'not my run to decide',
        }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, runId);

    expect(attempt.status).toBe(404);
    expect(attempt.body.error).toBe('unknown_run');
    await other.close();
  });

  test('the four core decisions still render', async ({ page }) => {
    await screen(page, PASS_CASE);
    await expect(page.getByTestId('decision-badge')).toHaveText(/PASS/);

    await screen(page, BLOCK_CASE);
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);

    await page.unroute('**/api/analyze');
    await makeProtectFail(page);
    await screen(page, PASS_CASE);
    await expect(page.getByTestId('decision-badge')).toHaveText(/Unavailable/i);
  });
});
