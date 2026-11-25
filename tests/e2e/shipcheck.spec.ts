import { expect, test } from '@playwright/test';

test('scans built-in broken target fixture and renders Critical issues on scorecard', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: /Catch broken APIs, console crashes/i })
  ).toBeVisible();

  await page.getByRole('button', { name: /Try Sample Broken Site/i }).click();

  await expect(page).toHaveURL(/\/reports\/[a-zA-Z0-9_-]+/);

  await expect(
    page.getByRole('button', { name: /Copy Markdown Bug Report/i })
  ).toBeVisible({ timeout: 30000 });

  await expect(page.getByText(/Grade [A-F]/)).toBeVisible();
  await expect(page.getByText(/Critical/i).first()).toBeVisible();

  // Filter to Critical issues and expand the first finding
  await page.getByRole('button', { name: 'Critical', exact: true }).click();
  const firstIssue = page.locator('h3').first();
  await expect(firstIssue).toBeVisible();
  await firstIssue.click();
  await expect(page.getByText('How to Fix').first()).toBeVisible();
});
