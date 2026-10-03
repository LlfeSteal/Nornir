import { expect, Page, test } from '@playwright/test';
import { attentionTree, mockApi } from './fixtures';

// Portfolios: named saved views — the filters, the period and the time scale — kept in the
// browser (nornir.portfolios), one of them optionally the default. Today is October 15, 2026.

const STORE = 'nornir.portfolios';
const rowNames = (page: Page) => page.locator('main .task-list-cell').evaluateAll((cells) => cells.map((c) => c.getAttribute('title')));
const portfolioButton = (page: Page) => page.getByRole('button', { name: /^Portfolio/ });
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE);
const search = (page: Page) => page.getByRole('textbox', { name: 'Search' });

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

async function openMenu(page: Page) {
  await portfolioButton(page).click();
  return page.getByRole('dialog', { name: 'Portfolio' });
}

async function pickPeriod(page: Page, label: string) {
  await page.getByRole('button', { name: /^Period:/ }).click();
  await page.getByRole('menuitemradio', { name: label }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(page, { body: attentionTree });
});

test('a portfolio saves the filters, the period and the time scale, and brings them back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTitle('Search', { exact: true })).toBeVisible();

  await pickPeriod(page, 'This quarter');
  await page.getByRole('radio', { name: 'Day' }).click();
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Issues' }).click();
  await page.getByRole('group', { name: 'Attention summary' }).getByRole('button', { name: '1 late' }).click();
  await expect.poll(() => rowNames(page)).toEqual(['Payments']);

  let menu = await openMenu(page);
  await menu.getByRole('button', { name: 'Save as portfolio…' }).click();
  await menu.getByRole('textbox', { name: 'Portfolio name' }).fill('Late work');
  await menu.getByRole('button', { name: 'Save' }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Late work');
  await expect(portfolioButton(page)).toHaveAttribute('data-active', 'true');
  expect(await stored(page)).toMatchObject({
    portfolios: [{ name: 'Late work', query: 'period=quarter&view=day&types=m%2Ce&attention=late' }],
  });

  // No portfolio clears the filters; the period and the scale stay.
  menu = await openMenu(page);
  await menu.getByRole('menuitemradio', { name: /^No portfolio/ }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio');
  await expect(page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Issues' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Period: Q4 2026' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');

  // Elsewhere, then back to the portfolio: everything comes back.
  await pickPeriod(page, 'All dates');
  await page.getByRole('radio', { name: 'Month' }).click();
  await (await openMenu(page)).getByRole('menuitemradio', { name: 'Late work' }).click();
  await expect(page.getByRole('button', { name: 'Period: Q4 2026' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Issues' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('group', { name: 'Attention summary' }).getByRole('button', { name: '1 late' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => rowNames(page)).toEqual(['Payments']);
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Late work');
});

test('a portfolio can be edited, renamed, made the default and deleted', async ({ page }) => {
  await seed(page, { portfolios: [{ id: 'p1', name: 'Mine', query: 'period=all&view=week&q=Pay' }] });
  await page.goto('/');
  await (await openMenu(page)).getByRole('menuitemradio', { name: 'Mine' }).click();
  await expect(search(page)).toHaveValue('Pay');
  await search(page).fill('Payments');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Mine (edited)');

  let menu = await openMenu(page);
  await menu.getByRole('button', { name: 'Save changes to “Mine”' }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Mine');

  // A name is required.
  menu = await openMenu(page);
  await menu.getByRole('button', { name: 'Rename “Mine”…' }).click();
  await menu.getByRole('textbox', { name: 'Portfolio name' }).fill(' ');
  await menu.getByRole('button', { name: 'Rename' }).click();
  await expect(menu.getByRole('alert')).toHaveText('Enter a name');
  await menu.getByRole('textbox', { name: 'Portfolio name' }).fill('My payments');
  await menu.getByRole('button', { name: 'Rename' }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: My payments');

  menu = await openMenu(page);
  await menu.getByRole('button', { name: 'Use as default' }).click();
  expect(await stored(page)).toEqual({
    portfolios: [{ id: 'p1', name: 'My payments', query: 'period=all&view=week&q=Payments' }],
    defaultId: 'p1',
  });

  // A new visit, without a view in the URL, opens on the default portfolio's view.
  await page.goto('/');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: My payments');
  await expect(search(page)).toHaveValue('Payments');
  await expect((await openMenu(page)).getByRole('menuitemradio', { name: 'My payments' })).toContainText('Default');

  // Deleting asks first; the view shown stays.
  menu = page.getByRole('dialog', { name: 'Portfolio' });
  await menu.getByRole('button', { name: 'Delete “My payments”…' }).click();
  await expect(menu).toContainText('Delete “My payments”?');
  await menu.getByRole('button', { name: 'Cancel' }).click();
  await menu.getByRole('button', { name: 'Delete “My payments”…' }).click();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio');
  await expect(search(page)).toHaveValue('Payments');
  expect(await stored(page)).toEqual({ portfolios: [] });
});

test('a link carries the filters, not the name, and wins over the default portfolio', async ({ page, browser }) => {
  await seed(page, {
    portfolios: [
      { id: 'p1', name: 'Mine', query: 'period=all&view=week&q=Pay' },
      { id: 'p2', name: 'Other', query: 'period=year&view=month&blocked=1' },
    ],
    defaultId: 'p2',
  });
  // Someone who saved the same view sees its name.
  await page.goto('/?period=all&q=Pay');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Mine');

  // Someone else sees the same filters, under no name; their own storage is left alone.
  const other = await browser.newPage();
  await other.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(other, { body: attentionTree });
  await other.goto('/?period=all&q=Pay');
  await expect(other.getByRole('textbox', { name: 'Search' })).toHaveValue('Pay');
  await expect(portfolioButton(other)).toHaveAccessibleName('Portfolio');
  expect(await other.evaluate((key) => localStorage.getItem(key), STORE)).toBeNull();
  await other.close();

  // A URL with any view in it: the default portfolio doesn't apply.
  await page.goto('/?period=all');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio');
  await expect(page.getByRole('search').getByRole('button', { name: 'Blocked', exact: true })).toHaveAttribute('aria-pressed', 'false');
});
