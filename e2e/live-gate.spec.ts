import { expect, test } from '@playwright/test';

/**
 * The cost gate, exercised against a deployment that reports `live`.
 *
 * This file runs on its own server (see `playwright.config.ts`) because the run
 * mode is a server-side fact, not a client flag: a mock deployment must not be
 * able to render the live wording, and a live deployment must not be able to
 * skip the confirmation. The API itself is never called — every screening is
 * answered by a canned body fetched from the mock server once, then served to
 * the page by a request stub.
 */

const TEXT = 'Quarterly planning notes for the platform team. Nothing risky in this one.';

test.describe('live mode cost gate', () => {
  let canned: Record<string, unknown>;

  test.beforeAll(async ({ request }) => {
    const response = await request.post('http://127.0.0.1:3100/api/analyze', {
      data: { text: TEXT, contentType: 'support_ticket', caseId: null, caseTitle: null, instructions: null },
    });
    expect(response.ok()).toBeTruthy();
    canned = (await response.json()) as Record<string, unknown>;
  });

  test('asks before a second live screen, and sends nothing when the answer is no', async ({ page }) => {
    let requests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/analyze')) requests += 1;
    });
    await page.route('**/api/analyze', (route) => route.fulfill({ json: canned }));

    await page.goto('/');
    await expect(page.locator('header').getByText('Live', { exact: true })).toBeVisible();

    await page.getByRole('textbox', { name: 'Content to screen' }).fill(TEXT);
    await page.getByRole('button', { name: /Screen content/ }).click();
    await expect(page.getByTestId('decision-badge')).toBeVisible({ timeout: 30_000 });
    expect(requests).toBe(1);

    // -- Screen again: asks first ------------------------------------------
    await page.getByRole('button', { name: 'Screen again' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Confirm a new screening request' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('goes to the Clocked API');
    await expect(dialog).toContainText('Clocked credits');
    expect(requests).toBe(1);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(requests).toBe(1);

    // -- Accepting sends exactly one request --------------------------------
    await page.getByRole('button', { name: 'Screen again' }).click();
    await page.getByRole('button', { name: 'Yes, screen again' }).click();
    await expect.poll(() => requests).toBe(2);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Screen again' })).toBeEnabled();

    // The confirmation is gone, so a second click is one prompt, not two.
    await page.getByRole('button', { name: 'Screen again' }).click();
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).last().click();
    expect(requests).toBe(2);

    // -- Edited text is gated the same way ---------------------------------
    await page.getByRole('button', { name: 'Edit input' }).click();
    await page.getByRole('textbox', { name: 'Content to screen' }).fill(`${TEXT} Edited.`);
    await page.getByRole('button', { name: /Screen changes/ }).click();

    const changes = page.getByRole('alertdialog', { name: 'Confirm a new screening request' });
    await expect(changes).toBeVisible();
    await expect(changes).toContainText('Screening your changes');
    expect(requests).toBe(2);

    await changes.getByRole('button', { name: 'Cancel' }).click();
    await expect(changes).toBeHidden();
    expect(requests).toBe(2);
  });
});
