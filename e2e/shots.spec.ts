import { test } from '@playwright/test';

const OUT = 'C:/Users/AICoder001/AppData/Local/Temp/trshots';

test('capture: desktop states', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/01-idle.png`, fullPage: true });

  const rail = page.locator('[data-testid="case-list"]:visible');
  await rail.getByRole('button', { name: /Classic prompt injection/ }).click();
  await page.getByRole('button', { name: /Screen content/ }).click();
  await page.getByTestId('decision-badge').waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/02-injection.png`, fullPage: true });

  await rail.getByRole('button', { name: /Ticket with personal data/ }).click();
  await page.getByRole('button', { name: /Screen content/ }).click();
  await page.getByTestId('decision-badge').waitFor();
  await page.getByRole('tab', { name: 'Forwarded copy' }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/03-pii-masked.png`, fullPage: true });

  await rail.getByRole('button', { name: /Script needing review/ }).click();
  await page.getByRole('button', { name: /Screen content/ }).click();
  await page.getByTestId('decision-badge').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/04-review.png`, fullPage: true });

  await page.getByRole('button', { name: /Review sheet/ }).click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/05-report.png` });
  await page.keyboard.press('Escape');
});

test('capture: mobile states', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/06-mobile-idle.png`, fullPage: true });
  const rail = page.locator('[data-testid="case-list"]:visible');
  await rail.getByRole('button', { name: /Ticket with personal data/ }).click();
  await page.getByRole('button', { name: /Screen content/ }).click();
  await page.getByTestId('decision-badge').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/07-mobile-result.png`, fullPage: true });
});
