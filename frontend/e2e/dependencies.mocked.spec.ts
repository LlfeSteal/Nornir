import { expect, Page, test } from '@playwright/test';
import { dependencyTree, mockApi } from './fixtures';

// GitLab blocking links: a mark on blocked rows, a warning when a row starts before its
// blocker ends, the Blocked filter, and the dialog listing the dependencies of a row and its
// descendants with arrows. Today is Thursday, October 15, 2026.

const listRow = (page: Page, name: string, scope = page.locator('main')) =>
  scope.locator('.task-list-row', { has: page.getByTitle(name, { exact: true }) });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Dependencies of [Milestone] 1.0' });
const rowNames = (scope: ReturnType<Page['locator']>) => scope.locator('.task-list-cell').evaluateAll((cells) => cells.map((c) => c.getAttribute('title')));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(page, { body: dependencyTree });
  await page.goto('/');
  await expect(page.getByTitle('Billing', { exact: true })).toBeVisible();
});

test('marks the items with an open blocker', async ({ page }) => {
  const mark = listRow(page, 'Billing').locator('.row-blocked');
  await expect(mark).toHaveAttribute('title', 'Blocked by Auth API');
  await expect(listRow(page, 'Billing').getByRole('img', { name: 'Blocked by Auth API' })).toBeVisible();
  await expect(listRow(page, 'Billing')).toHaveAttribute('data-blocked', 'true');
  await expect(listRow(page, 'Checkout').locator('.row-blocked')).toHaveAttribute('title', 'Blocked by Shipping rules, Vendor SDK');
  // A closed blocker doesn't block any more.
  await expect(listRow(page, 'Standalone issue').locator('.row-blocked')).toHaveCount(0);
  await expect(listRow(page, 'Auth API').locator('.row-blocked')).toHaveCount(0);

  // The tooltip lists both directions.
  const bar = page.locator('.bar', { has: page.locator('.bar-label', { hasText: /^Billing$/ }) });
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.gantt-tooltip .dependency-note')).toHaveText(['Blocked by Auth API']);
});

test('warns when an item starts before its blocker ends', async ({ page }) => {
  const warning = listRow(page, 'Checkout').locator('.row-warning');
  await expect(warning).toHaveAttribute('title', 'Starts 10 days before Shipping rules ends\nStarts 3 days before Vendor SDK ends');
  // Billing starts after Auth API ends.
  await expect(listRow(page, 'Billing').locator('.row-warning')).toHaveCount(0);
});

test('the Blocked filter lists the blocked items', async ({ page }) => {
  const blocked = page.getByRole('button', { name: 'Blocked', exact: true });
  await expect(blocked).toHaveAttribute('aria-pressed', 'false');
  await blocked.click();
  await expect(blocked).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => rowNames(page.locator('main'))).toEqual(['Billing', 'Checkout']);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTitle('Standalone issue', { exact: true })).toBeVisible();
});

test('rows with dependencies below them open them in a dialog', async ({ page }) => {
  await expect(listRow(page, '[Milestone] 1.0').getByRole('button', { name: 'View 3 dependencies' })).toBeVisible();
  await expect(listRow(page, '[Milestone] 2.0').getByRole('button', { name: 'View 1 dependency' })).toBeVisible();
  await expect(listRow(page, 'Checkout').getByRole('button', { name: 'View 2 dependencies' })).toBeVisible();
  // Its only link is to a closed item, hidden with the closed items.
  await expect(listRow(page, 'Standalone issue').locator('.row-dependencies')).toHaveCount(0);

  await listRow(page, '[Milestone] 1.0').getByRole('button', { name: 'View 3 dependencies' }).click();
  const sheet = dialog(page);
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('3 links · 5 items');
  // Flat rows, blockers first; no buttons inside.
  expect(await rowNames(sheet)).toEqual(['Vendor SDK', 'Auth API', 'Shipping rules', 'Checkout', 'Billing']);
  await expect(sheet.locator('.row-dependencies, .chevron')).toHaveCount(0);

  // Items linked from elsewhere say where they sit.
  const shipping = listRow(page, 'Shipping rules', sheet);
  await expect(shipping).toHaveAttribute('data-linked', 'true');
  await expect(shipping.locator('.task-list-detail')).toHaveText('In [Milestone] 2.0');
  const vendor = listRow(page, 'Vendor SDK', sheet);
  await expect(vendor).toHaveAttribute('data-external', 'true');
  await expect(vendor.locator('.task-list-detail')).toHaveText('Outside the group');
  await expect(listRow(page, 'Checkout', sheet)).not.toHaveAttribute('data-linked');

  // One arrow per link, red when the item starts before its blocker ends.
  const arrows = sheet.locator('.dependency-links > path');
  await expect(arrows).toHaveCount(3);
  await expect(sheet.locator('.dependency-links > path[data-conflict]')).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  await listRow(page, '[Milestone] 1.0').getByRole('button', { name: 'View 3 dependencies' }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await expect(dialog(page)).toHaveCount(0);

  // A click inside the sheet keeps it open; one on the dimmed page behind it closes it.
  await listRow(page, '[Milestone] 1.0').getByRole('button', { name: 'View 3 dependencies' }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('heading').click();
  await expect(dialog(page)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog(page)).toHaveCount(0);
});

test('an arrow runs from the blocker\'s end to the start of what it blocks', async ({ page }) => {
  // No opening animation: it scales the sheet while it plays.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await listRow(page, '[Milestone] 1.0').getByRole('button', { name: 'View 3 dependencies' }).click();
  const sheet = dialog(page);
  const barOf = (name: string) => sheet.locator('.bar', { has: page.locator('.bar-label', { hasText: new RegExp(`^${name}$`) }) });
  await expect(barOf('Billing')).toBeVisible();
  const auth = (await barOf('Auth API').boundingBox())!;
  const billing = (await barOf('Billing').boundingBox())!;
  // The arrow Auth API → Billing is the one without a conflict. Its geometry, from the page:
  // Playwright's boxes of SVG shapes take in the stroke and the arrowhead.
  const arrow = await sheet
    .locator('.dependency-links > path:not([data-conflict])')
    .evaluate((path) => JSON.parse(JSON.stringify(path.getBoundingClientRect())) as DOMRect);
  expect(Math.abs(arrow.x - (auth.x + auth.width))).toBeLessThan(2);
  expect(Math.abs(arrow.x + arrow.width - billing.x)).toBeLessThan(2);
  expect(Math.abs(arrow.y - (auth.y + auth.height / 2))).toBeLessThan(2);
  expect(Math.abs(arrow.y + arrow.height - (billing.y + billing.height / 2))).toBeLessThan(2);
});

test('arrows stay visible in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await listRow(page, '[Milestone] 1.0').getByRole('button', { name: 'View 3 dependencies' }).click();
  const arrow = dialog(page).locator('.dependency-links > path:not([data-conflict])');
  await expect(arrow).toHaveCSS('stroke', 'rgb(152, 152, 157)');
  await expect(dialog(page).locator('.dependency-links > path[data-conflict]').first()).toHaveCSS('stroke', 'rgb(255, 69, 58)');
});
