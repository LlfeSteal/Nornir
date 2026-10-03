import { expect, Page, test } from '@playwright/test';
import { dependencyTree, mockApi, nestedDependencyTree } from './fixtures';

// GitLab blocking links: a mark on blocked rows, a red hatch on the part of a bar planned
// before its blocker ends, the Blocked filter, and the dialog listing the dependencies of a row and its
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

test('hatches the part of a bar planned before its blocker ends', async ({ page }) => {
  await page.getByRole('radio', { name: 'Day' }).click();
  const barOf = (name: string) => page.locator('main .bar', { has: page.locator('.bar-label', { hasText: new RegExp(`^${name}$`) }) }).first();
  const checkout = barOf('Checkout');
  await expect(checkout).toHaveAttribute('data-conflict', 'true');
  // No warning sign: the hatch says it.
  await expect(listRow(page, 'Checkout').locator('.row-warning')).toHaveCount(0);

  // From Checkout's start (October 5) to the end of its latest blocker, Shipping rules (October 15).
  const hatch = checkout.locator('.bar-conflict');
  await expect(hatch).toBeVisible();
  const dayWidth = (await page.locator('.calendar-cell').first().boundingBox())!.width;
  const barBox = (await checkout.boundingBox())!;
  const hatchBox = (await hatch.boundingBox())!;
  expect(hatchBox.x).toBeCloseTo(barBox.x, 0);
  expect(hatchBox.width).toBeCloseTo(10 * dayWidth, 0);

  // The tooltip says which blockers end after it starts.
  const label = (await checkout.locator('.bar-label').boundingBox())!;
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await expect(page.locator('.gantt-tooltip .conflict-note')).toHaveText([
    'Starts 10 days before Shipping rules ends',
    'Starts 3 days before Vendor SDK ends',
  ]);

  // Billing starts after Auth API ends.
  await expect(barOf('Billing')).not.toHaveAttribute('data-conflict');
  await expect(barOf('Billing').locator('.bar-conflict')).toHaveCount(0);
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
  // Shipping rules (milestone 2.0) only blocks Checkout, in milestone 1.0: nothing is needed to finish them.
  await expect(listRow(page, '[Milestone] 2.0').locator('.row-dependencies')).toHaveCount(0);
  await expect(listRow(page, 'Shipping rules').locator('.row-dependencies')).toHaveCount(0);
  await expect(listRow(page, 'Auth API').locator('.row-dependencies')).toHaveCount(0);
  await expect(listRow(page, 'Billing').getByRole('button', { name: 'View 1 dependency' })).toBeVisible();
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
  await mockApi(page, { body: nestedDependencyTree });
  await page.reload();
  await page.emulateMedia({ colorScheme: 'dark' });
  await listRow(page, '[Milestone] Milestone 1').getByRole('button', { name: 'View 7 dependencies' }).click();
  const links = page.getByRole('dialog').locator('.dependency-links');
  await expect(links.locator('> path:not([data-conflict]):not([data-critical])').first()).toHaveCSS('stroke', 'rgb(152, 152, 157)');
  await expect(links.locator('> path[data-conflict]:not([data-critical])').first()).toHaveCSS('stroke', 'rgb(255, 69, 58)');
  await expect(links.locator('> path[data-critical]').first()).toHaveCSS('stroke', 'rgb(245, 245, 247)');
});

test('the dialog brings the critical path forward and dims the rest', async ({ page }) => {
  await listRow(page, '[Milestone] 1.0').getByRole('button', { name: 'View 3 dependencies' }).click();
  const sheet = dialog(page);
  // Of the milestone's leaves (Auth API, Billing, Checkout's Cart page), Billing ends last;
  // Auth API holds it up.
  await expect(sheet.locator('.dependency-dialog-title p')).toHaveText('3 links · 5 items · critical path of 2');
  const critical = sheet.locator('.task-list-row[data-critical]');
  await expect(critical).toHaveCount(2);
  expect(await critical.locator('.task-list-cell').evaluateAll((cells) => cells.map((c) => c.getAttribute('title')))).toEqual([
    'Auth API',
    'Billing',
  ]);
  await expect(listRow(page, 'Billing', sheet).locator('.task-list-name')).toHaveCSS('font-weight', '600');

  // Its bars at full strength, the others faded.
  const barOf = (name: string) => sheet.locator('.bar', { has: page.locator('.bar-label', { hasText: new RegExp(`^${name}$`) }) });
  await expect(barOf('Billing')).toHaveAttribute('data-critical', 'true');
  await expect(barOf('Billing')).toHaveCSS('opacity', '1');
  await expect(barOf('Checkout')).not.toHaveAttribute('data-critical');
  await expect(barOf('Checkout')).toHaveCSS('opacity', '0.35');

  // One critical arrow, a little thicker, in the strongest neutral.
  const arrow = sheet.locator('.dependency-links > path[data-critical]');
  await expect(arrow).toHaveCount(1);
  await expect(arrow).toHaveCSS('stroke', 'rgb(29, 29, 31)');
  await expect(arrow).toHaveCSS('stroke-width', '1.75px');
  await expect(arrow).toHaveCSS('opacity', '1');
  await expect(sheet.locator('.dependency-links > path:not([data-critical])').first()).toHaveCSS('opacity', '0.35');

  // The tooltip says it.
  const label = (await barOf('Billing').locator('.bar-label').boundingBox())!;
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await expect(page.locator('.gantt-tooltip .critical-note')).toHaveText('On the critical path');

  // The legend's critical arrow is the strongest neutral, in both appearances.
  const legendArrow = sheet.getByLabel('Dependencies legend').locator('.legend-arrow.critical');
  await expect(sheet.getByLabel('Dependencies legend')).toContainText('Critical path');
  await expect(sheet.getByLabel('Dependencies legend')).not.toContainText('Through parent epics');
  await expect(legendArrow).toHaveCSS('border-top-color', 'rgb(29, 29, 31)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(legendArrow).toHaveCSS('border-top-color', 'rgb(245, 245, 247)');
});

test('the dialog shows the items under their parents, without chevrons', async ({ page }) => {
  await mockApi(page, { body: nestedDependencyTree });
  await page.reload();
  await listRow(page, '[Milestone] Milestone 1').getByRole('button', { name: 'View 7 dependencies' }).click();
  const sheet = page.getByRole('dialog', { name: 'Dependencies of [Milestone] Milestone 1' });
  // Capability 2 has no link: shown for its place, not counted.
  await expect(sheet.locator('.dependency-dialog-title p')).toHaveText('7 links · 8 items · critical path of 4');
  const rows = sheet.locator('.task-list-row');
  expect(await rows.evaluateAll((list) => list.map((row) => [row.querySelector('.task-list-cell')!.getAttribute('title'), row.getAttribute('data-depth')]))).toEqual([
    ['Capability 2', '0'],
    ['Feature 2', '1'],
    ['US 1', '2'],
    ['Feature 1', '1'],
    ['US 6', '2'],
    ['US 7', '2'],
    ['US 9', '0'], // from elsewhere; starts with Feature 4, ends first
    ['Feature 4', '0'],
    ['US 10', '0'],
  ]);
  await expect(listRow(page, 'Capability 2', sheet)).toHaveAttribute('data-context', 'true');
  await expect(listRow(page, 'US 1', sheet)).not.toHaveAttribute('data-context');
  await expect(listRow(page, 'US 1', sheet).locator('.tree-branch')).toHaveCount(1);
  await expect(sheet.locator('.chevron')).toHaveCount(0);
});

test('the critical path goes from user story to user story, dashed through epics', async ({ page }) => {
  await mockApi(page, { body: nestedDependencyTree });
  await page.reload();
  await listRow(page, '[Milestone] Milestone 1').getByRole('button', { name: 'View 7 dependencies' }).click();
  const sheet = page.getByRole('dialog', { name: 'Dependencies of [Milestone] Milestone 1' });
  // US 7 ends last; US 6 holds it up; US 10 holds US 6 up through Feature 4 → Feature 1; US 9, US 10.
  expect(await rowNames(sheet.locator('.task-list-row[data-critical]'))).toEqual(['US 6', 'US 7', 'US 9', 'US 10']);
  // 7 GitLab links, plus the step US 10 → US 6, dashed.
  await expect(sheet.locator('.dependency-links > path')).toHaveCount(8);
  await expect(sheet.locator('.dependency-links > path[data-critical]')).toHaveCount(3);
  const derived = sheet.locator('.dependency-links > path[data-derived]');
  await expect(derived).toHaveCount(1);
  await expect(derived).toHaveAttribute('data-critical', 'true');
  await expect(derived).toHaveCSS('stroke', 'rgb(29, 29, 31)');
  await expect(derived).toHaveCSS('stroke-dasharray', '4px, 3px');
  await expect(sheet.getByLabel('Dependencies legend')).toContainText('Through parent epics');

  const barOf = (name: string) => sheet.locator('.bar', { has: page.locator('.bar-label', { hasText: new RegExp(`^${name}$`) }) });
  const label = (await barOf('US 6').locator('.bar-label').boundingBox())!;
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await expect(page.locator('.gantt-tooltip .critical-note')).toHaveText('On the critical path, after US 10 (through Feature 4 → Feature 1)');
});

test('the critical path can be shown alone', async ({ page }) => {
  await mockApi(page, { body: nestedDependencyTree });
  await page.reload();
  await listRow(page, '[Milestone] Milestone 1').getByRole('button', { name: 'View 7 dependencies' }).click();
  const sheet = page.getByRole('dialog', { name: 'Dependencies of [Milestone] Milestone 1' });
  const toggle = sheet.getByRole('button', { name: 'Critical path only' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(sheet.locator('.dependency-links > path')).toHaveCount(8);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('.dependency-links > path')).toHaveCount(3);
  await expect(sheet.locator('.dependency-links > path:not([data-critical])')).toHaveCount(0);
  // The path's user stories, under the parents they sit in (context rows).
  const rows = sheet.locator('.task-list-row');
  expect(await rows.evaluateAll((list) => list.map((row) => [row.querySelector('.task-list-cell')!.getAttribute('title'), row.getAttribute('data-depth'), row.getAttribute('data-context')]))).toEqual([
    ['Capability 2', '0', 'true'],
    ['Feature 1', '1', 'true'],
    ['US 6', '2', null],
    ['US 7', '2', null],
    ['US 9', '0', null],
    ['US 10', '0', null],
  ]);
  // The counts stay those of every dependency; the legend drops the arrows not shown.
  await expect(sheet.locator('.dependency-dialog-title p')).toHaveText('7 links · 8 items · critical path of 4');
  const legend = sheet.getByLabel('Dependencies legend');
  await expect(legend).toContainText('Critical path');
  await expect(legend).not.toContainText('Blocks');
  await expect(legend).not.toContainText('Starts before its blocker ends');

  await toggle.click();
  await expect(sheet.locator('.dependency-links > path')).toHaveCount(8);
  await expect(rows).toHaveCount(9);
  await expect(legend).toContainText('Blocks');
});

test('arrows from different blockers never run down the same line', async ({ page }) => {
  await mockApi(page, { body: nestedDependencyTree });
  await page.reload();
  await listRow(page, '[Milestone] Milestone 1').getByRole('button', { name: 'View 7 dependencies' }).click();
  const sheet = page.getByRole('dialog', { name: 'Dependencies of [Milestone] Milestone 1' });
  const arrows = sheet.locator('.dependency-links > path');
  await expect(arrows).toHaveCount(8);
  // Each arrow's polyline: its start (the blocker's end), then its corners (the curves' control points).
  const lines = await arrows.evaluateAll((paths) =>
    paths.map((path) => [...path.getAttribute('d')!.matchAll(/[MQ]([\d.-]+),([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])])),
  );
  const verticals = lines.map((points) => ({
    from: points[0].join(','),
    x: points[1][0],
    low: Math.min(points[1][1], points[2][1]),
    high: Math.max(points[1][1], points[2][1]),
  }));
  const clashes = verticals.flatMap((a, i) =>
    verticals.slice(i + 1).filter((b) => a.from !== b.from && Math.abs(a.x - b.x) < 1 && a.low < b.high && b.low < a.high).map((b) => [a, b]),
  );
  expect(clashes).toEqual([]);

  // Small arrowheads, whatever the stroke; a quiet today line.
  for (const marker of await sheet.locator('.dependency-links marker').all()) {
    await expect(marker).toHaveAttribute('markerUnits', 'userSpaceOnUse');
    await expect(marker).toHaveAttribute('markerWidth', '6');
  }
  await expect(sheet.locator('.today-line')).toHaveCSS('opacity', '0.5');
  await expect(page.locator('main .today-line')).toHaveCSS('opacity', '1');
});

test('the main chart dims nothing', async ({ page }) => {
  await expect(page.locator('.gantt-chart[data-critical-path]')).toHaveCount(0);
  await expect(page.locator('main .bar').first()).toHaveCSS('opacity', '1');
});
