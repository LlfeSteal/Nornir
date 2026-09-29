import { expect, Page, test } from '@playwright/test';
import { healthTree, mockApi } from './fixtures';

// GitLab health status: a "!" (needs attention) or "!!" (at risk) glyph after the name and
// before the bar label, filled for the row's own status, hollow when it comes from its open
// descendants; the counts in the help tag and the tooltip.

const RED = '#ff3b30'; // systemRed, light appearance
const ORANGE = '#ff9500'; // systemOrange
const DARK_RED = '#ff453a';

function toHex(color: string) {
  return '#' + color.match(/\d+/g)!.slice(0, 3).map((c) => Number(c).toString(16).padStart(2, '0')).join('');
}

/** The list row named `name`. */
const listRow = (page: Page, name: string) => page.locator('.task-list-row', { has: page.getByTitle(name, { exact: true }) });

/** The health glyph of a list row: its text, whether it is filled, and its colors. */
async function glyph(page: Page, name: string) {
  const badge = listRow(page, name).locator('.health');
  await expect(badge).toBeVisible();
  return badge.evaluate((el) => ({
    text: el.textContent,
    own: el.hasAttribute('data-own'),
    color: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
    label: el.getAttribute('aria-label'),
  }));
}

/** The bar whose label is `name`. */
const bar = (page: Page, name: string) => page.locator('.bar', { has: page.locator('.bar-label', { hasText: name }) }).first();

/** The dashed outline of a bar (or legend swatch): its style and color as #rrggbb. */
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

test('flags the rows at risk or needing attention, hollow when it comes from below', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTitle('Payments')).toBeVisible();

  // Payments is on track itself, but holds an issue at risk: hollow red "!!".
  let payments = await glyph(page, 'Payments');
  expect(payments).toMatchObject({ text: '!!', own: false, label: '1 at risk · 1 needs attention below' });
  expect(toHex(payments.color)).toBe(RED);
  await expect(listRow(page, 'Payments')).toHaveAttribute('data-health', 'atRisk');

  // The milestone only holds an issue needing attention: hollow orange "!".
  const sprint = await glyph(page, '[Milestone] Sprint 1');
  expect(sprint).toMatchObject({ text: '!', own: false, label: '1 needs attention below' });
  expect(toHex(sprint.color)).toBe(ORANGE);

  // Nothing on a row without health status below it.
  await expect(listRow(page, 'Onboarding')).toBeVisible();
  await expect(listRow(page, 'Onboarding').locator('.health')).toHaveCount(0);

  // The issues' own status: filled glyphs.
  await expandRow(page, 'Payments');
  const refund = await glyph(page, 'Refund API');
  expect(refund).toMatchObject({ text: '!!', own: true, label: 'At risk' });
  expect(toHex(refund.background)).toBe(RED);
  expect(toHex(refund.color)).toBe('#ffffff');
  const webhooks = await glyph(page, 'Webhooks');
  expect(webhooks).toMatchObject({ text: '!', own: true, label: 'Needs attention' });
  expect(toHex(webhooks.background)).toBe(ORANGE);

  // A dashed outline around the bars: red at risk, orange needs attention, own or from below.
  expect(await outline(bar(page, 'Refund API'))).toEqual({ style: 'dashed', color: RED });
  expect(await outline(bar(page, 'Webhooks'))).toEqual({ style: 'dashed', color: ORANGE });
  expect(await outline(bar(page, 'Payments'))).toEqual({ style: 'dashed', color: RED });
  expect(await outline(bar(page, 'Sprint 1'))).toEqual({ style: 'dashed', color: ORANGE });
  expect((await outline(bar(page, 'Onboarding'))).style).toBe('none');

  // A closed item isn't flagged, even with a health status.
  await page.getByRole('button', { name: 'Closed' }).click();
  await expect(listRow(page, 'Old risk')).toBeVisible();
  await expect(listRow(page, 'Old risk').locator('.health')).toHaveCount(0);
  expect((await outline(bar(page, 'Old risk'))).style).toBe('none');

  // The bars carry the same glyph before their label; their color stays the schedule's.
  const refundBar = page.locator('.bar', { has: page.locator('.bar-label', { hasText: 'Refund API' }) });
  await expect(refundBar).toHaveAttribute('data-health', 'atRisk');
  await expect(refundBar.locator('.bar-label .health[data-own]')).toHaveText('!!');
  const paymentsBar = page.locator('.bar', { has: page.locator('.bar-label', { hasText: 'Payments' }) });
  await expect(paymentsBar).toHaveAttribute('data-schedule', 'on-track');
  await expect(paymentsBar.locator('.bar-label .health:not([data-own])')).toHaveText('!!');
});

test('the tooltip shows the own status and the counts below', async ({ page }) => {
  await page.goto('/');
  const label = await page.locator('.bar-label', { hasText: 'Payments' }).boundingBox();
  await page.mouse.move(label!.x + label!.width / 2, label!.y + label!.height / 2);
  const tooltip = page.locator('.gantt-tooltip');
  await expect(tooltip).toContainText('Health: On track');
  await expect(tooltip).toContainText('Below: 1 at risk · 1 needs attention');
  const below = tooltip.locator('.health-note[data-health="atRisk"] strong');
  expect(toHex(await below.evaluate((el) => getComputedStyle(el).color))).toBe(RED);
});

test('the glyphs follow the dark appearance', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const payments = await glyph(page, 'Payments');
  expect(toHex(payments.color)).toBe(DARK_RED);
  expect(toHex(payments.background)).toBe('#1c1c1e'); // --card
  expect(await outline(bar(page, 'Payments'))).toEqual({ style: 'dashed', color: DARK_RED });
});

test('the legend explains the glyphs and the outlines', async ({ page }) => {
  await page.goto('/');
  const legend = page.getByLabel('Legend');
  const item = (text: string) => legend.locator('.legend-health', { hasText: text });
  await expect(item('At risk').locator('.health')).toHaveText('!!');
  await expect(item('Needs attention').locator('.health')).toHaveText('!');
  expect(await outline(item('At risk').locator('.legend-swatch'))).toEqual({ style: 'dashed', color: RED });
  expect(await outline(item('Needs attention').locator('.legend-swatch'))).toEqual({ style: 'dashed', color: ORANGE });
  // Bars without dates now have gray dashes: orange dashes only mean "needs attention".
  expect(await outline(legend.locator('.legend-swatch.undated'))).toEqual({ style: 'dashed', color: '#8e8e93' });
});
