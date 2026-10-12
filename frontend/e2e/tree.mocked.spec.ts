import { expect, Page, test } from '@playwright/test';
import { healthTree, mockApi } from './fixtures';

// The Results switch of the filter bar: List (a flat list of the matches, each with its whole
// content) or Tree (the hierarchy cut down to the matches, opened down to them, with the
// ancestors that don't match grayed for their place).

/** The list rows: name, depth, and "context" when kept only for its place. */
const rows = (page: Page) =>
  page.locator('main .task-list-row').evaluateAll((list) =>
    list.map((row) => {
      const name = row.querySelector('.task-list-cell')!.getAttribute('title')!;
      return `${'  '.repeat(Number(row.getAttribute('data-depth')))}${name}${row.hasAttribute('data-filter-context') ? ' (context)' : ''}`;
    }),
  );
const search = (page: Page) => page.getByRole('textbox', { name: 'Search' });
const results = (page: Page) => page.getByRole('radiogroup', { name: 'Results' });
const listRow = (page: Page, name: string) => page.locator('main .task-list-row', { has: page.getByTitle(name, { exact: true }) }).first();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  await mockApi(page, { body: healthTree });
});

test('Tree keeps the hierarchy down to the matches, their parents grayed', async ({ page }) => {
  await page.goto('/');
  await expect(results(page)).toHaveCount(0); // only while filtering
  await search(page).fill('Webhooks');
  await expect.poll(() => rows(page)).toEqual(['Webhooks']);
  await expect(results(page).getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');

  await results(page).getByRole('radio', { name: 'Tree' }).click();
  // Opened down to the matches without a click; Onboarding (no match) and Refund API are gone.
  await expect.poll(() => rows(page)).toEqual(['[Milestone] Sprint 1 (context)', '  Webhooks', 'Payments (context)', '  Webhooks']);
  await expect(page).toHaveURL(/layout=tree/);

  // Context rows: secondary name color and a dimmed bar.
  const nameColor = (name: string) => listRow(page, name).locator('.task-list-name').evaluate((el) => getComputedStyle(el).color);
  expect(await nameColor('Payments')).not.toBe(await nameColor('Webhooks'));
  const contextBar = page.locator('.bar[data-filter-context]').first();
  await expect(contextBar).toHaveCSS('opacity', '0.35');
  await expect(page.locator('.bar:not([data-filter-context])').first()).toHaveCSS('opacity', '1');
  await contextBar.hover();
  await expect(page.locator('.gantt-tooltip .context-note')).toHaveText('Shown for its place: doesn\'t match the filters');
});

test('a context row collapses; switching layouts opens the tree again', async ({ page }) => {
  await page.goto('/?q=Webhooks&layout=tree');
  await expect.poll(() => rows(page)).toEqual(['[Milestone] Sprint 1 (context)', '  Webhooks', 'Payments (context)', '  Webhooks']);

  await listRow(page, 'Payments').getByRole('button', { name: 'Collapse' }).click();
  await expect.poll(() => rows(page)).toEqual(['[Milestone] Sprint 1 (context)', '  Webhooks', 'Payments (context)']);

  await results(page).getByRole('radio', { name: 'List' }).click();
  await expect.poll(() => rows(page)).toEqual(['Webhooks']);
  await results(page).getByRole('radio', { name: 'Tree' }).click();
  await expect.poll(() => rows(page)).toEqual(['[Milestone] Sprint 1 (context)', '  Webhooks', 'Payments (context)', '  Webhooks']);
});

test('the layout survives a reload and Clear', async ({ page }) => {
  await page.goto('/?q=Refund&layout=tree');
  await expect.poll(() => rows(page)).toEqual(['Payments (context)', '  Refund API']);
  await page.reload();
  await expect.poll(() => rows(page)).toEqual(['Payments (context)', '  Refund API']);

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(results(page)).toHaveCount(0);
  await expect.poll(() => rows(page)).toEqual(['[Milestone] Sprint 1', 'Payments', 'Onboarding']);
  await search(page).fill('Logs');
  await expect(results(page).getByRole('radio', { name: 'Tree' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => rows(page)).toEqual(['Onboarding (context)', '  Logs']);
});

test('epics whose children are filtered out keep their group bar and schedule color', async ({ page }) => {
  await page.goto('/?types=e&layout=tree');
  await expect.poll(() => rows(page)).toEqual(['Payments', 'Onboarding']);
  const payments = page.locator('.bar', { has: page.locator('.bar-label', { hasText: 'Payments' }) });
  await expect(payments).toHaveAttribute('data-group', 'true');
  await expect(payments).toHaveAttribute('data-schedule', /.+/);
  await expect(payments.locator('.linear-progress')).toHaveCount(1);
});
