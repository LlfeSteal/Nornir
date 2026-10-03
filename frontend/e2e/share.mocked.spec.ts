import { expect, test } from '@playwright/test';
import { mockApi, attentionTree } from './fixtures';

// The view lives in the URL (period, time scale, filters), so a reload or a
// link shows the same chart; Copy link puts it in the clipboard. Today is October 15, 2026.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(page, { body: attentionTree });
});

test('the URL follows the view, and a reload brings it back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTitle('Search', { exact: true })).toBeVisible();
  // The remembered period isn't the default: it is in the URL.
  await expect(page).toHaveURL(/\?period=all$/);

  await page.getByRole('textbox', { name: 'Search' }).fill('pay');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Issues' }).click();
  await page.getByRole('radio', { name: 'Day' }).click();
  await expect(page).toHaveURL(/\?period=all&view=day&q=pay&types=m%2Ce$/);

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Search' })).toHaveValue('pay');
  await expect(page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Issues' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTitle('Payments', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Search', { exact: true })).toHaveCount(0);
});

test('a link opens on its own view, not on the recipient\'s preferences', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'quarter'));
  await page.goto('/?q=Refunds');
  await expect(page.getByRole('button', { name: 'Period: 2026' })).toBeVisible(); // the default, not the stored quarter
  await expect(page.getByRole('textbox', { name: 'Search' })).toHaveValue('Refunds');
});

test('Copy link copies a link to the view', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search' }).fill('pay');

  const copy = page.getByRole('button', { name: 'Copy link' });
  await copy.click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(baseURL!).origin}/?period=all&q=pay`);
  await expect(copy).toBeVisible(); // back after a moment
});
