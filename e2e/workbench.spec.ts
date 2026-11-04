import { expect, test } from '@playwright/test';

import { readFileSync } from 'node:fs';

import type { AnalyzeResponse } from '@/lib/types';

const UNAVAILABLE_HEADLINE = 'Screening unavailable — manual review required.';

/**
 * Let the real request run, then alter the answer before the page sees it.
 * The mutation is exactly what the policy engine produces when Protect fails,
 * so the test exercises the UI's handling of an incomplete run rather than a
 * hand-written fixture that could drift from the server contract.
 */
async function patchAnalyze(page: import('@playwright/test').Page, mutate: (body: AnalyzeResponse) => void) {
  await page.route('**/api/analyze', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as AnalyzeResponse;
    mutate(body);
    await route.fulfill({ response, json: body });
  });
}

function failProtect(body: AnalyzeResponse) {
  body.stages.protect = {
    ...body.stages.protect,
    status: 'quota',
    data: null,
    credits: null,
    error: {
      code: 'insufficient_credits',
      message: 'The Clocked account is out of credits for this request.',
      retryable: false,
      httpStatus: 402,
    },
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
    headline: UNAVAILABLE_HEADLINE,
    requiresHumanReview: true,
    canForwardMasked: false,
    reasons: [
      {
        code: 'detection_incomplete',
        label: 'Protect (PII) did not complete',
        detail: 'The Clocked account is out of credits for this request. TrustRoute does not release content that was not fully screened.',
        severity: 'review',
        source: 'pipeline',
      },
    ],
    actions: [
      'Do not treat this run as a risk verdict: at least one required detection returned no result.',
      'Re-run the failed detection, or screen the content somewhere that can reach the API.',
      'Until then, a reviewer must read the content itself before anything is released.',
    ],
    checks: [
      ...body.policy.checks.filter((check) => check.id !== 'screening_complete'),
      {
        id: 'screening_complete',
        label: 'Required detections completed',
        observed: 'at least one did not complete',
        threshold: 'all required',
        outcome: 'failed',
        source: 'pipeline',
      },
    ],
  };
}

const CASES = {
  safe: 'Routine support ticket',
  pii: 'Ticket with personal data',
  injection: 'Classic prompt injection',
  review: 'Script needing review',
} as const;

async function caseButton(page: import('@playwright/test').Page, title: string) {
  // Three examples are on the first screen; the other five sit behind "More
  // examples". Only one case list is visible (desktop and mobile differ).
  const target = page.locator('[data-testid="case-list"]:visible').getByRole('button', { name: new RegExp(title) });
  if (!(await target.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /More examples/ }).click();
  }
  return target;
}

async function loadAndScreen(page: import('@playwright/test').Page, title: string) {
  await (await caseButton(page, title)).click();
  await page.getByRole('button', { name: /Screen content/ }).click();
  await expect(page.getByTestId('decision-badge')).toBeVisible({ timeout: 30_000 });
}

test.describe('TrustRoute workbench', () => {
  test('states its problem, its mode and its cases on first load', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Screen untrusted content');
    await expect(page.getByText('DEMO · SIMULATED RESULTS')).toBeVisible();
    await expect(page.getByText('Why is this a demo and not the live API?')).toBeVisible();
    await expect(page.locator('[data-testid="case-list"]:visible').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Screen content/ })).toBeDisabled();
    await expect(page.getByText('How the decision is made')).toBeVisible();
  });

  test('screens a routine ticket to PASS with stage evidence', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.safe);

    await expect(page.getByTestId('decision-badge')).toHaveText(/PASS/);
    await expect(page.getByText('Guard · prompt injection')).toBeVisible();
    await expect(page.getByText('Protect · personal data')).toBeVisible();
    await expect(page.getByText('No injection signal')).toBeVisible();
    await expect(page.getByRole('status', { name: /Screening decision/ })).toContainText('Safe to forward.');
  });

  test('blocks a classic prompt injection and explains why', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);

    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);
    await expect(page.getByText('Prompt injection detected')).toBeVisible();
    await expect(page.getByRole('status', { name: /Screening decision/ })).toContainText('Do not forward this content');
  });

  test('masks personal data and offers a forwarded copy', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.pii);

    await expect(page.getByTestId('decision-badge')).toHaveText(/PASS/);
    await expect(page.getByText('Personal data masked')).toBeVisible();

    await page.getByRole('tab', { name: 'Forwarded copy' }).click();
    const masked = page.locator('pre').first();
    await expect(masked).toContainText('<EMAIL>');
    await expect(masked).toContainText('<PERSON>');
    await expect(masked).not.toContainText('alex.mercer@example.com');
  });

  test('holds a risky script for review, then records the human decision', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.review);

    await expect(page.getByTestId('decision-badge')).toHaveText(/REVIEW/);
    await expect(page.getByText('Inspect · script behaviour')).toBeVisible();

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/reviewer override/)).toBeVisible();
    await expect(page.getByText(/Approved internally/)).toBeVisible();
    await expect(page.getByTestId('decision-badge')).toHaveText(/PASS/);
    await expect(page.getByText(/Approved by a reviewer/)).toBeVisible();
  });

  test('exports a JSON report that carries no raw personal data', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.pii);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /JSON report/ }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^trustroute-.*\.json$/);
    const path = await download.path();
    expect(path).toBeTruthy();
    const raw = readFileSync(path!, 'utf8');
    const report = JSON.parse(raw) as Record<string, unknown>;

    expect(raw).not.toContain('alex.mercer@example.com');
    expect(raw).not.toContain('Alex Mercer');
    expect(report.schema).toBe('trustroute.review-report/1');
    expect((report.generator as { transport: string }).transport).toBe('mock');
    expect((report.decision as { decision: string }).decision).toBe('PASS');
  });

  test('opens and closes the printable review sheet', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.safe);

    await page.getByRole('button', { name: /Review sheet/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Review sheet' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Disclaimers');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('rejects empty input instead of screening nothing', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Screen content/ })).toBeDisabled();
    await page.getByRole('textbox', { name: 'Content to screen' }).fill('   ');
    await expect(page.getByRole('button', { name: /Screen content/ })).toBeDisabled();
  });

  test('shows the evidence passage and locates it in the source', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);

    const evidence = page.getByRole('region', { name: 'Evidence' });
    await expect(evidence).toBeVisible();

    const firstPassage = evidence.getByRole('button').first();
    await expect(firstPassage).toContainText('L');
    await firstPassage.click();

    await expect(firstPassage).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('tab', { name: 'As received' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('mark[data-start]').first()).toBeVisible();
  });

  test('shows the rule trace behind the decision', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);

    await page.getByText('Rule trace').click();
    await expect(page.getByText('Injection probability vs block line')).toBeVisible();
    await expect(page.getByText('Guard returned a usable result')).toBeVisible();
  });

  test('refuses to record a rejection without a reason', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.review);

    await expect(page.getByTestId('decision-badge')).toHaveText(/REVIEW/);
    await expect(page.getByRole('button', { name: 'Reject' })).toBeDisabled();

    await page.getByRole('textbox', { name: 'Reviewer note' }).fill('customer asked us to stop');
    await page.getByRole('button', { name: 'Reject' }).click();

    await expect(page.getByText('Rejected. The content stays blocked inside TrustRoute.')).toBeVisible();
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);
    await expect(page.getByText('customer asked us to stop')).toBeVisible();
  });

  test('shows the mask map so a reviewer can see what changed', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.pii);

    await page.getByRole('tab', { name: 'Forwarded copy' }).click();
    await expect(page.getByText(/Mask map ·/)).toBeVisible();
    await expect(page.getByRole('button', { name: /<EMAIL>/ })).toBeVisible();
  });
  test('never describes a simulated run as Clocked output', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.pii);

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Matches Clocked anonymized_text/);
    expect(body).not.toMatch(/returned by Clocked/);
    expect(body).not.toMatch(/endpoint threshold/);
    expect(body).not.toMatch(/Clocked (Guard|Protect|Inspect) returned/);

    // And it says what it is, at the point where the numbers are.
    await expect(page.getByText(/nothing compared with Clocked/i)).toBeVisible();
    await expect(page.getByText('Simulated · no API call').first()).toBeVisible();
    await expect(page.getByText(/local Guard simulator/i).first()).toBeVisible();
  });

  test('one click from the landing page produces a decision', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('try-blocked').click();
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/, { timeout: 30_000 });
    await expect(page.getByText('Prompt injection detected').first()).toBeVisible();
  });

  test('states why a decision was made without opening the rule trace', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);

    await expect(page.getByText('Prompt injection detected').first()).toBeVisible();
    await expect(page.getByText(/The Gateway blocks content that is trying to redirect the agent/).first()).toBeVisible();
  });

  test('locates a masked value back in the original text', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.pii);

    await page.getByRole('tab', { name: 'Forwarded copy' }).click();
    await page.getByRole('button', { name: /<EMAIL>/ }).click();

    await expect(page.getByRole('tab', { name: 'As received' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('mark[data-start]').first()).toBeVisible();
  });

  test('shows a compact decision bar above the results on a narrow screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'narrow-screen only');
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);

    const bar = page.getByText(/Do not forward this content/).first();
    await expect(bar).toBeVisible();
    await page.getByRole('link', { name: 'Why' }).click();
    await expect(page).toHaveURL(/#decision$/);
  });

  test('says screening is unavailable instead of reporting a verdict', async ({ page }) => {
    await page.goto('/');
    await patchAnalyze(page, failProtect);
    await loadAndScreen(page, CASES.pii);

    // Not a decision: the badge says there is no verdict.
    await expect(page.getByTestId('decision-badge')).toContainText('Unavailable');
    await expect(page.getByTestId('decision-badge')).not.toContainText('REVIEW');
    await expect(page.getByRole('status', { name: /Screening decision/ })).toContainText(UNAVAILABLE_HEADLINE);
    await expect(page.getByText(/no risk verdict/i)).toBeVisible();

    // The failed stage explains the consequence, not just the error.
    await expect(page.getByText('Credit / concurrency limit').first()).toBeVisible();
    await expect(page.getByText(/contributed nothing.*screening unavailable/i).first()).toBeVisible();

    // And the forwarded copy cannot be mistaken for a masked one.
    await page.getByRole('tab', { name: 'Forwarded copy' }).click();
    await expect(page.getByText(/Protect did not complete, so nothing was masked/)).toBeVisible();
  });

  test('exports an incomplete run as incomplete, not as a risk assessment', async ({ page }) => {
    await page.goto('/');
    await patchAnalyze(page, failProtect);
    await loadAndScreen(page, CASES.pii);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /JSON report/ }).click(),
    ]);
    const raw = readFileSync(await download.path(), 'utf8');
    const report = JSON.parse(raw) as {
      decision: { decision: string; screening: string; degraded: boolean };
      disclaimers: string[];
    };

    expect(report.decision.screening).toBe('unavailable');
    expect(report.decision.degraded).toBe(true);
    expect(report.decision.decision).toBe('REVIEW');
    expect(report.disclaimers.join(' ')).toMatch(/not a risk assessment/i);
  });

  test('reports an unavailable service rather than inventing a decision', async ({ page }) => {
    await page.goto('/');
    await page.route('**/api/analyze', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'not_configured',
          message: 'CLOCKED_MODE=live but CLOCKED_API_KEY is missing.',
          hint: 'Set CLOCKED_API_KEY to screen real content.',
        }),
      }),
    );
    await (await caseButton(page, CASES.safe)).click();
    await page.getByRole('button', { name: /Screen content/ }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Screening unavailable' })).toBeVisible();
    await expect(page.getByTestId('decision-badge')).toHaveCount(0);
  });

  test('cancels a slow screen without leaving a decision behind', async ({ page }) => {
    await page.goto('/');
    let requests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/analyze')) requests += 1;
    });
    await page.route('**/api/analyze', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      try {
        await route.abort('failed');
      } catch {
        // The page cancelled first, which is the point of the test.
      }
    });
    await (await caseButton(page, CASES.safe)).click();
    await page.getByRole('button', { name: /Screen content/ }).click();

    // Cancel only exists while a screen is in flight — so its presence is the
    // assertion that the button really entered the loading state.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText(/Screening cancelled before a decision/)).toBeVisible();
    await expect(page.getByTestId('decision-badge')).toHaveCount(0);
    expect(requests).toBe(1);
  });

  test('shows the unavailable state above the results on a narrow screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'narrow-screen only');
    await page.goto('/');
    await patchAnalyze(page, failProtect);
    await loadAndScreen(page, CASES.pii);

    const bar = page.locator('[data-screening="unavailable"]').first();
    await expect(bar).toContainText(UNAVAILABLE_HEADLINE);
    await expect(bar.getByRole('link', { name: 'Why' })).toBeVisible();
  });

  test('reports a failed request instead of a decision', async ({ page }) => {
    await page.goto('/');
    await page.route('**/api/analyze', (route) => route.abort('failed'));
    await (await caseButton(page, CASES.safe)).click();
    await page.getByRole('button', { name: /Screen content/ }).click();

    // Next.js injects its own `role="alert"` route announcer, so match by content.
    await expect(page.getByRole('alert').filter({ hasText: 'Network error' })).toBeVisible();
    await expect(page.getByTestId('decision-badge')).toHaveCount(0);
  });
});
