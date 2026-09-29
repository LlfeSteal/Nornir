import { expect, Page, test } from '@playwright/test';
import { healthTree, mockApi } from './fixtures';

// GitLab health status: a "!" (needs attention) or "!!" (at risk) glyph after the name and
// before the bar label, the same for the row's own status and for its open descendants'; the counts in the help tag and the tooltip; the Health filter.

const RED = '#ff3b30'; // systemRed, light appearance
const ORANGE = '#ff9500'; // systemOrange
const DARK_RED = '#ff453a';

function toHex(color: string) {
  return '#' + color.match(/\d+/g)!.slice(0, 3).map((c) => Number(c).toString(16).padStart(2, '0')).join('');
}

/** The list row named `name`. */
const listRow = (page: Page, name: string) => page.locator('.task-list-row', { has: page.getByTitle(name, { exact: true }) });

/** The health glyph of a list row: its text and its colors. */
async function glyph(page: Page, name: string) {
  const badge = listRow(page, name).locator('.health');
  await expect(badge).toBeVisible();
  return badge.evaluate((el) => ({
    text: el.textContent,
    color: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
    label: el.getAttribute('aria-label'),
  }));
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

  // Payments is on track itself, but holds an issue at risk: red "!!", like the issue's own.
  const payments = await glyph(page, 'Payments');
  expect(payments).toMatchObject({ text: '!!', label: '1 at risk · 1 needs attention below' });
  expect(toHex(payments.background)).toBe(RED);
  expect(toHex(payments.color)).toBe('#ffffff');
  await expect(listRow(page, 'Payments')).toHaveAttribute('data-health', 'atRisk');

  // The milestone only holds an issue needing attention: orange "!".
  const sprint = await glyph(page, '[Milestone] Sprint 1');
  expect(sprint).toMatchObject({ text: '!', label: '1 needs attention below' });
  expect(toHex(sprint.background)).toBe(ORANGE);

  // Nothing on a row without health status below it.
  await expect(listRow(page, 'Onboarding')).toBeVisible();
  await expect(listRow(page, 'Onboarding').locator('.health')).toHaveCount(0);

  // The issues' own status: the same glyphs.
  await expandRow(page, 'Payments');
  const refund = await glyph(page, 'Refund API');
  expect(refund).toMatchObject({ text: '!!', label: 'At risk' });
  expect(toHex(refund.background)).toBe(RED);
  expect(toHex(refund.color)).toBe('#ffffff');
  const webhooks = await glyph(page, 'Webhooks');
  expect(webhooks).toMatchObject({ text: '!', label: 'Needs attention' });
  expect(toHex(webhooks.background)).toBe(ORANGE);

  // No outline around the bars: the glyph is enough.
  for (const name of ['Refund API', 'Webhooks', 'Payments', 'Sprint 1', 'Onboarding']) {
    expect((await outline(bar(page, name))).style).toBe('none');
  }

  // A closed item isn't flagged, even with a health status.
  await page.getByRole('button', { name: 'Closed' }).click();
  await expect(listRow(page, 'Old risk')).toBeVisible();
  await expect(listRow(page, 'Old risk').locator('.health')).toHaveCount(0);

  // The bars carry the same glyph before their label; their color stays the schedule's.
  const refundBar = page.locator('.bar', { has: page.locator('.bar-label', { hasText: 'Refund API' }) });
  await expect(refundBar).toHaveAttribute('data-health', 'atRisk');
  await expect(refundBar.locator('.bar-label .health')).toHaveText('!!');
  const paymentsBar = page.locator('.bar', { has: page.locator('.bar-label', { hasText: 'Payments' }) });
  await expect(paymentsBar).toHaveAttribute('data-schedule', 'on-track');
  await expect(paymentsBar.locator('.bar-label .health')).toHaveText('!!');
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

test('the glyphs follow the dark appearance', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const payments = await glyph(page, 'Payments');
  expect(toHex(payments.background)).toBe(DARK_RED);
  expect(toHex(payments.color)).toBe('#ffffff');
});

test('the legend explains the glyphs', async ({ page }) => {
  await page.goto('/');
  const legend = page.getByLabel('Legend');
  const item = (text: string) => legend.locator('.legend-health', { hasText: text });
  await expect(item('At risk').locator('.health')).toHaveText('!!');
  await expect(item('Needs attention').locator('.health')).toHaveText('!');
  await expect(item('At risk').locator('.legend-swatch')).toHaveCount(0);
  // Bars without dates have gray dashes.
  expect(await outline(legend.locator('.legend-swatch.undated'))).toEqual({ style: 'dashed', color: '#8e8e93' });
});
