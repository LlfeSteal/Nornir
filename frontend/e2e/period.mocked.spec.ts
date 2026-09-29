import { expect, Page, test } from '@playwright/test';
import { mockApi, periodTree } from './fixtures';

// The period selector: presets, ‹ › arrows, rows outside the period hidden, bars cut at
// its edges. Today is Thursday, October 15, 2026.

async function open(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(page, { body: periodTree });
  await page.goto('/');
}

/** Names of the visible list rows, in order. */
async function rowNames(page: Page) {
  return page.locator('.task-list-cell').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('title')));
}

async function pickPreset(page: Page, label: string) {
  await page.getByRole('button', { name: /^Period:/ }).click();
  await page.getByRole('menuitemradio', { name: label }).click();
}

test.describe('period', () => {
  test('opens on this year, in Month view, without the rows of other years', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('button', { name: 'Period: 2026' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTitle('Long epic')).toBeVisible();
    expect(await rowNames(page)).toEqual(['[Milestone] Q4 sprint', 'Current epic', 'Long epic']);

    // The timeline starts with the period, not with the earliest item (June).
    await page.locator('.gantt-scroll').evaluate((scroller) => (scroller.scrollLeft = 0));
    await expect(page.locator('.calendar-cell').first()).toHaveText('January');

    // The long epic's only issue is in 2027: nothing to expand this year.
    await expect(page.getByTitle('Long epic').getByRole('button', { name: 'Expand' })).toHaveCount(0);
    // The current epic's 2025 issue is hidden.
    await page.getByTitle('Current epic').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Current issue')).toBeVisible();
    await expect(page.getByTitle('Stale issue')).toHaveCount(0);
  });

  test('bars are cut at the end of the period, the tooltip keeps the real dates', async ({ page }) => {
    await open(page);
    const label = page.locator('.bar-label', { hasText: 'Long epic' });
    await expect(label).toBeVisible();
    const columnWidth = (await page.locator('.calendar-cell').first().boundingBox())!.width;
    const barWidth = async () => (await page.locator('.bar', { has: label }).boundingBox())!.width;
    // June → end of December: 7 month columns.
    expect(await barWidth()).toBeCloseTo(7 * columnWidth, 0);

    const box = (await label.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.gantt-tooltip')).toContainText('From Jun 1, 2026 to Mar 31, 2027');

    // With every date, the bar goes on to the end of March.
    await pickPreset(page, 'All dates');
    await expect.poll(barWidth).toBeGreaterThan(9.5 * columnWidth);
  });

  test('the arrows move through the past and the future, Today comes back', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Previous period' }).click();
    await expect(page.getByRole('button', { name: 'Period: 2025' })).toBeVisible();
    await expect(page.getByTitle('Old epic')).toBeVisible();
    await expect(page.getByTitle('Long epic')).toHaveCount(0);
    // Kept for its 2025 issue.
    await expect(page.getByTitle('Current epic')).toBeVisible();
    // Today isn't in 2025: the chart shows the period from its start.
    await expect.poll(() => page.locator('.gantt-scroll').evaluate((scroller) => scroller.scrollLeft)).toBe(0);
    await expect(page.locator('.calendar-cell').first()).toHaveText('January');

    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.getByRole('button', { name: 'Period: 2026' })).toBeVisible();
    await expect(page.getByTitle('Old epic')).toHaveCount(0);

    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(page.getByRole('button', { name: 'Period: 2027' })).toBeVisible();
    expect(await rowNames(page)).toEqual(['Long epic', 'Future epic']);
  });

  test('presets pick their period and time scale', async ({ page }) => {
    await open(page);
    await pickPreset(page, 'This quarter');
    await expect(page.getByRole('button', { name: 'Period: Q4 2026' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTitle('Long epic')).toBeVisible();
    await expect(page.locator('.today-line')).toHaveCount(1);

    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(page.getByRole('button', { name: 'Period: Q1 2027' })).toBeVisible();
    expect(await rowNames(page)).toEqual(['Long epic']);
    await page.getByTitle('Long epic').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Next year issue')).toBeVisible();

    await pickPreset(page, '3 years');
    await expect(page.getByRole('button', { name: 'Period: 2025 – 2027' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    expect(await rowNames(page)).toEqual(
      expect.arrayContaining(['[Milestone] Q4 sprint', 'Old epic', 'Current epic', 'Long epic', 'Future epic']),
    );

    await pickPreset(page, 'All dates');
    await expect(page.getByRole('button', { name: 'Period: All dates' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous period' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next period' })).toBeDisabled();
  });

  test('an empty period says so and offers every date', async ({ page }) => {
    await open(page);
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Previous period' }).click();
    await expect(page.getByRole('button', { name: 'Period: 2023' })).toBeVisible();
    await expect(page.getByText('Nothing in this period')).toBeVisible();
    await expect(page.locator('.task-list-row')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show all dates' }).click();
    await expect(page.getByRole('button', { name: 'Period: All dates' })).toBeVisible();
    await expect(page.getByTitle('Old epic')).toBeVisible();
  });

  test('the preset is remembered, not the arrows', async ({ page }) => {
    await open(page);
    await pickPreset(page, 'This quarter');
    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(page.getByRole('button', { name: 'Period: Q1 2027' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Period: Q4 2026' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
  });
});
