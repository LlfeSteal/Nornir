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

test('a changed portfolio is updated from the footer', async ({ page }) => {
  await seed(page, { portfolios: [{ id: 'p1', name: 'Mine', query: 'period=all&view=week&q=Pay' }] });
  await page.goto('/');
  let menu = await openMenu(page);
  await expect(menu.getByRole('button', { name: 'Save as portfolio…' })).toBeEnabled();
  await menu.getByRole('menuitemradio', { name: 'Mine' }).click();
  await expect(search(page)).toHaveValue('Pay');
  // Its own view: nothing to save.
  menu = await openMenu(page);
  await expect(menu.getByRole('button', { name: 'Save as portfolio…' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await search(page).fill('Payments');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Mine (edited)');
  menu = await openMenu(page);
  // Update replaces Save as portfolio… while the portfolio is changed.
  await expect(menu.getByRole('button', { name: 'Save as portfolio…' })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Update “Mine”' }).click();
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Mine');
  expect(await stored(page)).toEqual({ portfolios: [{ id: 'p1', name: 'Mine', query: 'period=all&view=week&q=Payments' }] });
});

test('a portfolio is renamed in place, from its pencil or F2', async ({ page }) => {
  await seed(page, { portfolios: [{ id: 'p1', name: 'Mine', query: 'period=all&view=week&q=Pay' }, { id: 'p2', name: 'Other', query: 'period=year&view=month' }] });
  await page.goto('/');
  const menu = await openMenu(page);
  const row = menu.locator('.portfolio-row', { has: page.getByRole('menuitemradio', { name: 'Mine' }) });

  // The pencil shows on hover; the name becomes a field, selected.
  await row.hover();
  await expect(row.getByRole('button', { name: 'Rename “Mine”' })).toHaveCSS('opacity', '1');
  await row.getByRole('button', { name: 'Rename “Mine”' }).click();
  const field = menu.getByRole('textbox', { name: 'Portfolio name' });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Mine');
  // Names are required and unique.
  await field.fill('other');
  await field.press('Enter');
  await expect(menu.getByRole('alert')).toHaveText('“other” already exists');
  await field.fill(' ');
  await field.press('Enter');
  await expect(menu.getByRole('alert')).toHaveText('Enter a name');
  await field.fill('My payments');
  await field.press('Enter');
  await expect(menu.getByRole('menuitemradio', { name: 'My payments' })).toBeFocused();
  expect((await stored(page)).portfolios[0].name).toBe('My payments');

  // Escape: nothing changes, and the menu stays open.
  await menu.locator('.portfolio-row').first().hover();
  await menu.getByRole('button', { name: 'Rename “My payments”' }).click();
  await field.fill('Nope');
  await field.press('Escape');
  await expect(menu.getByRole('menuitemradio', { name: 'My payments' })).toBeVisible();

  // F2 on the focused item.
  await menu.getByRole('menuitemradio', { name: 'Other' }).focus();
  await page.keyboard.press('F2');
  await field.fill('Others');
  await field.press('Enter');
  expect((await stored(page)).portfolios.map((p: { name: string }) => p.name)).toEqual(['My payments', 'Others']);
});

test('the star makes a portfolio the default; the bin deletes it, asking first', async ({ page }) => {
  await seed(page, { portfolios: [{ id: 'p1', name: 'Mine', query: 'period=all&view=week&q=Pay' }] });
  await page.goto('/');
  let menu = await openMenu(page);
  const star = menu.getByRole('button', { name: 'Use “Mine” as default' });
  await expect(star).toHaveCSS('opacity', '0'); // only on hover or focus
  await menu.locator('.portfolio-row').hover();
  await star.click();
  const set = menu.getByRole('button', { name: 'Stop using “Mine” as default' });
  await expect(set).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toMatchObject({ defaultId: 'p1' });
  await page.mouse.move(0, 0);
  await expect(set).toHaveCSS('opacity', '1'); // the default's star always shows

  // A new visit, without a view in the URL, opens on the default portfolio's view.
  await page.goto('/');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Mine');
  await expect(search(page)).toHaveValue('Pay');

  // The bin asks on the row; Cancel keeps it.
  menu = await openMenu(page);
  const row = menu.locator('.portfolio-row').filter({ hasText: 'Mine' });
  await row.hover();
  await row.getByRole('button', { name: 'Delete “Mine”' }).click();
  await expect(menu.locator('.portfolio-row[data-confirm]')).toContainText('Delete “Mine”?');
  await expect(menu.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await menu.getByRole('button', { name: 'Cancel' }).click();
  await expect(menu.getByRole('menuitemradio', { name: 'Mine' })).toBeVisible();

  await menu.locator('.portfolio-row').filter({ hasText: 'Mine' }).hover();
  await menu.getByRole('button', { name: 'Delete “Mine”' }).click();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(menu.getByRole('menuitemradio', { name: 'Mine' })).toHaveCount(0);
  await expect(menu).toBeVisible(); // the menu stays open
  await page.keyboard.press('Escape');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio');
  await expect(search(page)).toHaveValue('Pay'); // the view stays
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
  // Changed after opening the link: it is theirs, edited.
  await search(page).fill('Payments');
  await expect(portfolioButton(page)).toHaveAccessibleName('Portfolio: Mine (edited)');

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
