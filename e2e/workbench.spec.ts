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
    await expect(page.getByText('Mock preview — no Clocked API key is configured.')).toBeVisible();
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
    await expect(page.getByText('Safe to forward.', { exact: false })).toBeVisible();
  });

  test('blocks a classic prompt injection and explains why', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);

    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);
    await expect(page.getByText('Prompt injection detected')).toBeVisible();
    await expect(page.getByText('Do not forward this content')).toBeVisible();
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
});
