import { expect, test } from '@playwright/test';

import { readFileSync } from 'node:fs';

const CASES = {
  safe: 'Routine support ticket',
  pii: 'Ticket with personal data',
  injection: 'Classic prompt injection',
  review: 'Script needing review',
} as const;

function caseButton(page: import('@playwright/test').Page, title: string) {
  // The rail and the mobile strip render the same cases; only one is visible.
  return page
    .locator('[data-testid="case-list"]:visible')
    .getByRole('button', { name: new RegExp(title) });
}

async function loadAndScreen(page: import('@playwright/test').Page, title: string) {
  await caseButton(page, title).click();
  await page.getByRole('button', { name: /Screen content/ }).click();
  await expect(page.getByTestId('decision-badge')).toBeVisible({ timeout: 30_000 });
}

test.describe('TrustRoute workbench', () => {
  test('states its problem, its mode and its cases on first load', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Untrusted content should be inspected');
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

  test('reports a failed request instead of a decision', async ({ page }) => {
    await page.goto('/');
    await page.route('**/api/analyze', (route) => route.abort('failed'));
    await caseButton(page, CASES.safe).click();
    await page.getByRole('button', { name: /Screen content/ }).click();

    // Next.js injects its own `role="alert"` route announcer, so match by content.
    await expect(page.getByRole('alert').filter({ hasText: 'Network error' })).toBeVisible();
    await expect(page.getByTestId('decision-badge')).toHaveCount(0);
  });
});
