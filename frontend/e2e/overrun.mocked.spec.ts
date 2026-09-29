import { expect, Page, test } from '@playwright/test';
import { mockApi, overrunTree } from './fixtures';

// A child planned past its parent's end: only the part of its bar beyond the parent's end is
// hatched in red (`.bar-overrun`), and the tooltip says by how many days. Today is Thursday,
// October 15, 2026.

const listRow = (page: Page, name: string) => page.locator('.task-list-row', { has: page.getByTitle(name, { exact: true }) });
const bar = (page: Page, name: string) => page.locator('.bar', { has: page.locator('.bar-label', { hasText: name }) }).first();
const expandRow = (page: Page, name: string) => listRow(page, name).getByRole('button', { name: 'Expand' }).click();

async function box(locator: ReturnType<Page['locator']>) {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
}

async function open(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(page, { body: overrunTree });
  await page.goto('/');
}

test.describe('planned past the parent', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  });

  test('hatches in red only the days past the parent\'s end', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: 'Day' }).click();
    await expandRow(page, 'Parent epic');
    const dayWidth = (await box(page.locator('.calendar-cell').first())).width;

    // Late issue ends Oct 25, its parent Oct 20: 5 days hatched, from the parent's end to its own.
    const parent = await box(bar(page, 'Parent epic'));
    const late = await box(bar(page, 'Late issue'));
    const hatch = await box(bar(page, 'Late issue').locator('.bar-overrun'));
    expect(hatch.width).toBeCloseTo(5 * dayWidth, 0);
    expect(hatch.x).toBeCloseTo(parent.x + parent.width, 0);
    expect(hatch.x + hatch.width).toBeCloseTo(late.x + late.width, 0);
    await expect(bar(page, 'Late issue')).toHaveAttribute('data-overrun', 'true');
    const image = await bar(page, 'Late issue').locator('.bar-overrun').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(image).toContain('repeating-linear-gradient');
    expect(image).toContain('rgb(255, 59, 48)'); // systemRed

    // Inside it, starting before it, with a made-up due date: nothing.
    for (const name of ['Inside issue', 'Early issue', 'No due issue', 'Parent epic']) {
      await expect(bar(page, name)).toBeVisible();
      await expect(bar(page, name).locator('.bar-overrun')).toHaveCount(0);
    }

    // A closed child isn't flagged: its work is done.
    await page.getByRole('button', { name: 'Closed' }).click();
    await expect(bar(page, 'Closed late issue')).toBeVisible();
    await expect(bar(page, 'Closed late issue').locator('.bar-overrun')).toHaveCount(0);
  });

  test('an item is judged against its milestone too', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: 'Day' }).click();
    await expandRow(page, '[Milestone] Sprint 1');
    const dayWidth = (await box(page.locator('.calendar-cell').first())).width;
    const hatch = await box(bar(page, 'Sprint issue').locator('.bar-overrun'));
    expect(hatch.width).toBeCloseTo(2 * dayWidth, 0);
  });

  test('the tooltip says how many days past which parent', async ({ page }) => {
    await open(page);
    await expandRow(page, 'Parent epic');
    const label = await box(page.locator('.bar-label', { hasText: 'Late issue' }));
    await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
    const note = page.locator('.gantt-tooltip .overrun-note');
    await expect(note).toHaveText('Ends 5 days after Parent epic');
    const color = await note.locator('strong').evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe('rgb(255, 59, 48)');

    // Nothing on a child inside its parent.
    const inside = await box(page.locator('.bar-label', { hasText: 'Inside issue' }));
    await page.mouse.move(inside.x + inside.width / 2, inside.y + inside.height / 2);
    await expect(page.locator('.gantt-tooltip')).toContainText('Inside issue');
    await expect(page.locator('.gantt-tooltip .overrun-note')).toHaveCount(0);
  });

  test('a row listed at the top level by the filters has no parent: no hatch', async ({ page }) => {
    await open(page);
    await expandRow(page, 'Parent epic');
    await expect(bar(page, 'Late issue').locator('.bar-overrun')).toHaveCount(1);

    // Only Issues: every issue is listed flat, outside its epic.
    const show = page.getByRole('group', { name: 'Show' });
    await show.getByRole('button', { name: 'Milestones' }).click();
    await show.getByRole('button', { name: 'Epics' }).click();
    await expect(listRow(page, 'Late issue')).toHaveAttribute('data-depth', '0');
    await expect(bar(page, 'Late issue')).toBeVisible();
    await expect(page.locator('.bar-overrun')).toHaveCount(0);

    // Back in its epic, it is hatched again.
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(bar(page, 'Late issue').locator('.bar-overrun')).toHaveCount(1);
  });

  test('the hatch keeps its red in the dark appearance', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    await expandRow(page, 'Parent epic');
    const image = await bar(page, 'Late issue').locator('.bar-overrun').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(image).toContain('rgb(255, 69, 58)'); // systemRed, dark
  });

  test('the legend shows the red hatch', async ({ page }) => {
    await open(page);
    const legend = page.getByLabel('Legend');
    await expect(legend).toContainText('Past its parent');
    const image = await legend.locator('.legend-swatch.overrun').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(image).toContain('repeating-linear-gradient');
  });
});

test('the hatch is cut at the end of the period, the tooltip keeps the real overrun', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^Period:/ }).click();
  await page.getByRole('menuitemradio', { name: 'This quarter' }).click();
  await expect(page.getByRole('button', { name: 'Period: Q4 2026' })).toBeVisible();
  await expandRow(page, 'Quarter parent');

  // Scroll to the end of the quarter, where the hatch is.
  await page.locator('.gantt-scroll').evaluate((scroller) => (scroller.scrollLeft = scroller.scrollWidth));
  const parent = await box(bar(page, 'Quarter parent'));
  const child = await box(bar(page, 'Next year issue'));
  const hatch = await box(bar(page, 'Next year issue').locator('.bar-overrun'));
  expect(hatch.x).toBeCloseTo(parent.x + parent.width, 0);
  expect(hatch.x + hatch.width).toBeCloseTo(child.x + child.width, 0); // the bar, cut on Dec 31

  const label = await box(page.locator('.bar-label', { hasText: 'Next year issue' }));
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await expect(page.locator('.gantt-tooltip .overrun-note')).toHaveText('Ends 26 days after Quarter parent');
});
