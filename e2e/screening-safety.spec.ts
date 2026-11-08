import { expect, test, type Page } from '@playwright/test';

import { readFileSync } from 'node:fs';

/**
 * The safety properties that the final UX audit found broken.
 *
 * Three of them, in the order they can hurt a reader:
 *   1. a verdict must never be attached to text it was not produced from;
 *   2. a blocked run must never offer, or appear to offer, a forwarding path;
 *   3. getting out of a 3,000px result must not cost a screening.
 *
 * These are behavioural, not cosmetic: each one fails if the old behaviour
 * comes back, including the old wording.
 */

const CASES = {
  safe: 'Routine support ticket',
  pii: 'Ticket with personal data',
  injection: 'Classic prompt injection',
} as const;

/** The edit the tests paste over a blocked ticket. Deliberately boring. */
const EDITED = 'Standup notes: the CSV export bug is fixed and nothing else needs escalating.';

async function caseButton(page: Page, title: string) {
  const target = page.locator('[data-testid="case-list"]:visible').getByRole('button', { name: new RegExp(title) });
  if (!(await target.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /More examples/ }).click();
  }
  return target;
}

async function loadAndScreen(page: Page, title: string) {
  await (await caseButton(page, title)).click();
  await page.getByRole('button', { name: /Screen content/ }).click();
  await expect(page.getByTestId('decision-badge')).toBeVisible({ timeout: 30_000 });
}

/** Counts the requests that would spend a screening. */
function watchAnalyze(page: Page) {
  const counter = { value: 0 };
  page.on('request', (request) => {
    if (request.url().includes('/api/analyze')) counter.value += 1;
  });
  return counter;
}

async function downloadedReport(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /JSON report/ }).click(),
  ]);
  return JSON.parse(readFileSync(await download.path(), 'utf8')) as {
    subject: { characters: number; textHashSha256Prefix: string };
    protection: { maskedText: string | null };
    decision: { decision: string };
    disclaimers: string[];
  };
}

test.describe('screening safety', () => {
  test('a new screening clears the box without spending a request', async ({ page }) => {
    await page.goto('/');
    const requests = watchAnalyze(page);
    await loadAndScreen(page, CASES.injection);

    await page.getByRole('button', { name: 'New screening', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Screen untrusted content');
    await expect(page.getByRole('textbox', { name: 'Content to screen' })).toHaveValue('');
    await expect(page.getByTestId('decision-badge')).toHaveCount(0);
    expect(requests.value).toBe(1);
  });

  test('the way out stays in reach from deep inside a result', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const exit = page.getByRole('button', { name: 'Start a new screening' });
    await expect(exit).toBeInViewport();

    await exit.click();
    await expect(page.getByRole('textbox', { name: 'Content to screen' })).toHaveValue('');
    await expect(page.getByTestId('decision-badge')).toHaveCount(0);
  });

  test('an edit cannot inherit the previous verdict', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);

    await page.getByRole('button', { name: 'Edit input' }).click();
    const box = page.getByRole('textbox', { name: 'Content to screen' });
    await box.fill(EDITED);

    // Nothing is decided while the text is being edited.
    await expect(page.getByTestId('decision-badge')).toHaveCount(0);
    await expect(page.getByText(/These edits have not been screened/)).toBeVisible();

    await page.getByRole('button', { name: 'Back to result' }).click();

    // The old verdict is still there — and it says which text it belongs to.
    await expect(page.getByTestId('unscreened-edits')).toBeVisible();
    await expect(page.getByTestId('unscreened-edits')).toContainText('belongs to the earlier text');
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);

    // The reader, the highlights and the evidence stay on the screened text.
    const reader = page.getByRole('region', { name: 'Content view' });
    await expect(reader).toContainText('IGNORE ALL PREVIOUS INSTRUCTIONS');
    await expect(reader).not.toContainText('Standup notes');
  });

  test('screening the edits produces a verdict for the new text', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);

    await page.getByRole('button', { name: 'Edit input' }).click();
    await page.getByRole('textbox', { name: 'Content to screen' }).fill(EDITED);
    await page.getByRole('button', { name: /Screen changes/ }).click();

    await expect(page.getByTestId('decision-badge')).toHaveText(/PASS|REVIEW/, { timeout: 30_000 });
    await expect(page.getByTestId('unscreened-edits')).toHaveCount(0);

    const reader = page.getByRole('region', { name: 'Content view' });
    await expect(reader).toContainText('Standup notes');
    await expect(reader).not.toContainText('IGNORE ALL PREVIOUS INSTRUCTIONS');
  });

  test('the export keeps describing the screened text after an edit', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.pii);
    const before = await downloadedReport(page);

    await page.getByRole('button', { name: 'Edit input' }).click();
    await page.getByRole('textbox', { name: 'Content to screen' }).fill(EDITED);
    await page.getByRole('button', { name: 'Back to result' }).click();

    const after = await downloadedReport(page);
    expect(after.subject.characters).toBe(before.subject.characters);
    expect(after.subject.textHashSha256Prefix).toBe(before.subject.textHashSha256Prefix);
    expect(after.subject.characters).not.toBe(EDITED.length);
  });

  test('a blocked run offers a sanitized preview, never a forwarded copy', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);
    await expect(page.getByTestId('decision-badge')).toHaveText(/BLOCK/);

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Forwarded copy');
    expect(body).not.toContain('See what the agent gets');
    expect(body).not.toContain('Copy masked');

    await page.getByRole('tab', { name: /Sanitized preview/ }).click();
    await expect(page.getByText('Sanitized preview · blocked')).toBeVisible();
    await expect(page.getByText(/not forwarded to the agent/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy sanitized' })).toBeVisible();
  });

  test('the blocked export and review sheet say the copy was not forwarded', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);

    const report = await downloadedReport(page);
    expect(report.decision.decision).toBe('BLOCK');
    expect(report.disclaimers.join(' ')).toMatch(/sanitized preview/i);
    expect(JSON.stringify(report)).not.toContain('would be forwarded');

    await page.getByRole('button', { name: /Review sheet/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Review sheet' });
    await expect(sheet).toContainText('Sanitized preview (blocked — not forwarded)');
    await expect(sheet).not.toContainText('Copy that would be forwarded');
  });

  test('a pass does not ask for a review note', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.safe);
    await expect(page.getByTestId('decision-badge')).toHaveText(/PASS/);

    await expect(page.getByRole('textbox', { name: 'Reviewer note' })).toHaveCount(0);

    // The override is still one click away — the capability is unchanged.
    await page.getByRole('button', { name: 'Override anyway' }).click();
    await expect(page.getByRole('textbox', { name: 'Reviewer note' })).toBeVisible();
  });

  test('focus lands on the result once a screen completes', async ({ page }) => {
    await page.goto('/');
    await loadAndScreen(page, CASES.injection);
    await expect(page.getByTestId('results')).toBeFocused();
  });

  test('a skip link comes before the header', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});
