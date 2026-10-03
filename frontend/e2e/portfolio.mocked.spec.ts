import { expect, Page, test } from '@playwright/test';
import { mockApi, portfolioTree } from './fixtures';

// Portfolios: named sets of milestones and epics, picked in the Items menu, saved in the
// browser (nornir.portfolios), one of them optionally the default. Today is October 15, 2026.

const STORE = 'nornir.portfolios';
const rowNames = (page: Page) => page.locator('main .task-list-cell').evaluateAll((cells) => cells.map((c) => c.getAttribute('title')));
const portfolioButton = (page: Page) => page.getByRole('button', { name: /^Portfolio/ });
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE);

/** Stores portfolios once, before the app reads them (not again on reload). */
async function seed(page: Page, value: unknown) {
  await page.addInitScript(
    ([key, json]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, json);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [STORE, JSON.stringify(value)] as const,
  );
}

async function pickItems(page: Page, names: string[]) {
  await page.getByRole('button', { name: /^Items/ }).click();
  const popover = page.getByRole('dialog', { name: 'Items' });
  for (const name of names) await popover.getByRole('option', { name, exact: true }).click();
  await page.keyboard.press('Escape');
}

async function openMenu(page: Page) {
  await portfolioButton(page).click();
  return page.getByRole('dialog', { name: 'Portfolio' });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(page, { body: portfolioTree });
});

test('items picked in the Items menu are shown alone, as a tree, and saved as a portfolio', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTitle('Search', { exact: true })).toBeVisible();
  await pickItems(page, ['Payments', '[Milestone] Release 1']);

  // The milestone, then the epic, with their content (collapsed).
  await expect(page.getByRole('button', { name: 'Items: 2 items' })).toBeVisible();
  await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Release 1', 'Payments']);
  await expect(page.getByTitle('Payments', { exact: true }).locator('..').getByRole('button', { name: 'Expand' })).toBeVisible();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio');

  const menu = await openMenu(page);
  await menu.getByRole('button', { name: 'Save as portfolio…' }).click();
  await menu.getByRole('textbox', { name: 'Portfolio name' }).fill('Release');
  await menu.getByRole('button', { name: 'Save' }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Release');
  await expect(portfolioButton(page)).toHaveAttribute('data-active', 'true');
  expect(await stored(page)).toMatchObject({ portfolios: [{ name: 'Release', items: ['w10', 'm1'] }] });

  // All items, then the portfolio again.
  await (await openMenu(page)).getByRole('menuitemradio', { name: 'All items' }).click();
  await expect.poll(async () => (await rowNames(page)).length).toBe(5);
  await (await openMenu(page)).getByRole('menuitemradio', { name: 'Release' }).click();
  await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Release 1', 'Payments']);
});

test('a portfolio can be edited, renamed, made the default and deleted', async ({ page }) => {
  await seed(page, { portfolios: [{ id: 'p1', name: 'Release', items: ['m1'] }] });
  await page.goto('/');
  await (await openMenu(page)).getByRole('menuitemradio', { name: 'Release' }).click();
  await pickItems(page, ['Search']);
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Release (edited)');

  let menu = await openMenu(page);
  await menu.getByRole('button', { name: 'Save changes to “Release”' }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Release');

  // A name is required and unique.
  menu = await openMenu(page);
  await menu.getByRole('button', { name: 'Rename “Release”…' }).click();
  await menu.getByRole('textbox', { name: 'Portfolio name' }).fill(' ');
  await menu.getByRole('button', { name: 'Rename' }).click();
  await expect(menu.getByRole('alert')).toHaveText('Enter a name');
  await menu.getByRole('textbox', { name: 'Portfolio name' }).fill('Release Q4');
  await menu.getByRole('button', { name: 'Rename' }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Release Q4');

  menu = await openMenu(page);
  await menu.getByRole('button', { name: 'Use as default' }).click();
  expect(await stored(page)).toEqual({ portfolios: [{ id: 'p1', name: 'Release Q4', items: ['m1', 'w20'] }], defaultId: 'p1' });

  // A new visit, without a view in the URL, opens on the default portfolio.
  await page.goto('/');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Release Q4');
  await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Release 1', 'Search']);
  await expect((await openMenu(page)).getByRole('menuitemradio', { name: 'Release Q4' })).toContainText('Default');

  // Deleting asks first; the items stay shown.
  menu = page.getByRole('dialog', { name: 'Portfolio' });
  await menu.getByRole('button', { name: 'Delete “Release Q4”…' }).click();
  await expect(menu).toContainText('Delete “Release Q4”?');
  await menu.getByRole('button', { name: 'Cancel' }).click();
  await menu.getByRole('button', { name: 'Delete “Release Q4”…' }).click();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio');
  expect(await stored(page)).toEqual({ portfolios: [] });
});

test('a link carries the items, not the name, and wins over the default portfolio', async ({ page, browser }) => {
  await seed(page, { portfolios: [{ id: 'p1', name: 'Mine', items: ['w10', 'm1'] }, { id: 'p2', name: 'Other', items: ['w40'] }], defaultId: 'p2' });
  // Someone who has a portfolio with the same items sees its name.
  await page.goto('/?items=m1,w10');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Mine');
  await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Release 1', 'Payments']);

  // Someone else sees the same items, under no name; their own storage is left alone.
  const other = await browser.newPage();
  await other.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(other, { body: portfolioTree });
  await other.goto('/?items=m1,w10');
  await expect(other.getByRole('button', { name: 'Items: 2 items' })).toBeVisible();
  await expect(portfolioButton(other)).toHaveAccessibleName('Portfolio');
  expect(await other.evaluate((key) => localStorage.getItem(key), STORE)).toBeNull();
  await other.close();

  // A URL with any view in it: the default portfolio doesn't apply.
  await page.goto('/?period=all');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio');
  await expect.poll(async () => (await rowNames(page)).length).toBe(5);
});
