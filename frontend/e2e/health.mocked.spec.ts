import { expect, Page, test } from '@playwright/test';
import { healthTree, mockApi } from './fixtures';

// GitLab health status: SF Symbols-style icons at the end of the list row — a red octagon
// (at risk) or an orange circle (needs attention) — the same for the row's own status and for
// its open descendants'; not on the bars; the counts in the help tag and the tooltip; the
// Health filter.

const RED = '#ff3b30'; // systemRed, light appearance
const ORANGE = '#ff9500'; // systemOrange
const DARK_RED = '#ff453a';

function toHex(color: string) {
  return '#' + color.match(/\d+/g)!.slice(0, 3).map((c) => Number(c).toString(16).padStart(2, '0')).join('');
}

/** The list row named `name`. */
const listRow = (page: Page, name: string) => page.locator('.task-list-row', { has: page.getByTitle(name, { exact: true }) });

/** The health icon of a list row: its shape, its color (#rrggbb) and its help tag. */
async function glyph(page: Page, name: string) {
  const badge = listRow(page, name).getByRole('img').and(page.locator('.health'));
  await expect(badge).toBeVisible();
  const icon = await badge.evaluate((el) => ({
    shape: el.querySelector('.health-shape')!.tagName === 'path' ? 'octagon' : 'circle',
    color: getComputedStyle(el).color,
    label: el.getAttribute('aria-label'),
  }));
  return { ...icon, color: toHex(icon.color) };
}

/** The bar whose label is `name`. */
const bar = (page: Page, name: string) => page.locator('.bar', { has: page.locator('.bar-label', { hasText: name }) }).first();

/** The outline of a bar or legend swatch: its style and color as #rrggbb. */
async function outline(locator: ReturnType<Page['locator']>) {
  const { style, color } = await locator.evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, color: getComputedStyle(el).outlineColor }));
  return { style, color: toHex(color) };
}

const expandRow = (page: Page, name: string) => listRow(page, name).getByRole('button', { name: 'Expand' }).click();

async function rowNames(page: Page) {
  return page.locator('.task-list-row .task-list-cell').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('title')));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  // The chart opens centered on today: keep the bars on screen.
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(page, { body: healthTree });
});

test('flags the rows at risk or needing attention, the same glyph whether it comes from the row or below', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTitle('Payments')).toBeVisible();

  // Payments is on track itself, but holds an issue at risk: red octagon, like the issue's own.
  expect(await glyph(page, 'Payments')).toEqual({ shape: 'octagon', color: RED, label: '1 at risk · 1 needs attention below' });
  await expect(listRow(page, 'Payments')).toHaveAttribute('data-health', 'atRisk');

  // The milestone only holds an issue needing attention: orange circle.
  expect(await glyph(page, '[Milestone] Sprint 1')).toEqual({ shape: 'circle', color: ORANGE, label: '1 needs attention below' });

  // Nothing on a row without health status below it.
  await expect(listRow(page, 'Onboarding')).toBeVisible();
  await expect(listRow(page, 'Onboarding').locator('.health')).toHaveCount(0);

  // The issues' own status: the same icons.
  await expandRow(page, 'Payments');
  expect(await glyph(page, 'Refund API')).toEqual({ shape: 'octagon', color: RED, label: 'At risk' });
  expect(await glyph(page, 'Webhooks')).toEqual({ shape: 'circle', color: ORANGE, label: 'Needs attention' });

  // At the end of the row, like a table cell accessory: aligned from row to row, whatever the
  // name's length and the row's depth.
  const edges = await page.locator('.task-list-row').evaluateAll((rows) =>
    rows
      .filter((row) => row.querySelector('.health'))
      .map((row) => ({
        icon: row.querySelector('.health')!.getBoundingClientRect().right,
        row: row.getBoundingClientRect().right,
      })),
  );
  expect(edges).toHaveLength(4);
  for (const edge of edges) {
    expect(edge.icon).toBeCloseTo(edges[0].icon, 0);
    expect(edge.row - edge.icon).toBeGreaterThanOrEqual(8); // not against the separator
    expect(edge.row - edge.icon).toBeLessThanOrEqual(16);
  }

  // No outline around the bars: the glyph is enough.
  for (const name of ['Refund API', 'Webhooks', 'Payments', 'Sprint 1', 'Onboarding']) {
    expect((await outline(bar(page, name))).style).toBe('none');
  }

  // A closed item isn't flagged, even with a health status.
  await page.getByRole('button', { name: 'Closed' }).click();
  await expect(listRow(page, 'Old risk')).toBeVisible();
  await expect(listRow(page, 'Old risk').locator('.health')).toHaveCount(0);

  // The bars stay clean: no icon on them, and their color stays the schedule's.
  await expect(bar(page, 'Refund API')).toHaveAttribute('data-health', 'atRisk');
  await expect(bar(page, 'Payments')).toHaveAttribute('data-schedule', 'on-track');
  await expect(page.locator('.bar .health')).toHaveCount(0);
});

test('the tooltip shows the own status and the counts below', async ({ page }) => {
  await page.goto('/');
  const label = await page.locator('.bar-label', { hasText: 'Payments' }).boundingBox();
  await page.mouse.move(label!.x + label!.width / 2, label!.y + label!.height / 2);
  const tooltip = page.locator('.gantt-tooltip');
  await expect(tooltip).toContainText('Health: On track');
  await expect(tooltip).toContainText('Below: 1 at risk · 1 needs attention');
  const below = tooltip.locator('.health-note[data-health="atRisk"]');
  expect(toHex(await below.locator('strong').evaluate((el) => getComputedStyle(el).color))).toBe(RED);
  // The icon in front of it; none in front of "On track".
  await expect(below.locator('.health[data-level="atRisk"] svg')).toBeVisible();
  await expect(tooltip.locator('.health-note[data-health="onTrack"] .health')).toHaveCount(0);
});

test('the Health filter lists the items with that status, milestones by their content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTitle('Payments')).toBeVisible();

  const pick = async (...options: string[]) => {
    await page.getByRole('button', { name: /^Health/ }).click();
    const popover = page.getByRole('dialog', { name: 'Health' });
    for (const option of options) await popover.getByRole('option', { name: option, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
  };

  await pick('At risk');
  await expect(page.getByRole('button', { name: 'Health: At risk' })).toHaveAttribute('data-active', 'true');
  await expect.poll(() => rowNames(page)).toEqual(['Refund API']);

  // Any of the statuses: milestones first (by their open items), then epics, then issues.
  await pick('Needs attention');
  await expect(page.getByRole('button', { name: 'Health: 2 statuses' })).toBeVisible();
  await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Sprint 1', 'Webhooks', 'Refund API']);

  await pick('At risk', 'Needs attention', 'On track');
  await expect.poll(() => rowNames(page)).toEqual(['Payments']);

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Sprint 1', 'Payments', 'Onboarding']);
});

test('the icons follow the dark appearance', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  expect((await glyph(page, 'Payments')).color).toBe(DARK_RED);
});

test('the legend explains the icons', async ({ page }) => {
  await page.goto('/');
  const legend = page.getByLabel('Legend');
  const item = (text: string) => legend.locator('.legend-health', { hasText: text });
  await expect(item('At risk').locator('.health[data-level="atRisk"] path.health-shape')).toBeVisible();
  await expect(item('Needs attention').locator('.health[data-level="needsAttention"] circle.health-shape')).toBeVisible();
  await expect(item('At risk').locator('.legend-swatch')).toHaveCount(0);
  // Bars without dates have gray dashes.
  expect(await outline(legend.locator('.legend-swatch.undated'))).toEqual({ style: 'dashed', color: '#8e8e93' });
});
