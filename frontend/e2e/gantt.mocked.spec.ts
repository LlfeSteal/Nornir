import { expect, Page, test } from '@playwright/test';
import { config, mockApi, tree } from './fixtures';

const LIST_WIDTH = 260;

/** Horizontal position of the today line, relative to its column and to the chart area. */
async function todayLinePosition(page: Page) {
  const line = page.locator('.today-line');
  await expect(line).toHaveCount(1);
  const lineBox = (await line.boundingBox())!;
  const chartBox = (await page.locator('.gantt-chart').boundingBox())!;
  const lineX = lineBox.x + lineBox.width / 2;
  // Today's column: the calendar cell under the line.
  const cells = await page.locator('.calendar-cell').evaluateAll((all) =>
    all.map((cell) => ({ x: cell.getBoundingClientRect().x, width: cell.getBoundingClientRect().width })),
  );
  const columnBox = cells.find((cell) => lineX >= cell.x && lineX < cell.x + cell.width)!;
  return {
    columnWidth: columnBox.width,
    /** Position of the line inside today's column, from 0 (start) to 1 (end). */
    fractionInColumn: (lineX - columnBox.x) / columnBox.width,
    offsetFromCenter: lineX - (chartBox.x + LIST_WIDTH + (chartBox.width - LIST_WIDTH) / 2),
  };
}

/** Height of a list row (and of a timeline row). */
async function rowHeight(page: Page) {
  return (await page.locator('.task-list-row').first().boundingBox())!.height;
}

/** Visible list rows, in order: name, tree depth and whether it is its parent's last child. */
async function listRows(page: Page) {
  return page.locator('.task-list-row').evaluateAll((rows) =>
    rows.map((row) => ({
      name: row.querySelector('.task-list-cell')!.getAttribute('title')!,
      depth: Number(row.getAttribute('data-depth')),
      last: !!row.querySelector('.tree-branch.last'),
      nameX: row.querySelector('.task-list-name')!.getBoundingClientRect().x,
      background: getComputedStyle(row).backgroundImage, // the group band is a layer
    })),
  );
}

/** The bar whose label is `name` (the first one when the name is repeated). */
function bar(page: Page, name: string, nth = 0) {
  return page.locator('.bar', { has: page.locator('.bar-label', { hasText: name }) }).nth(nth);
}

/** A computed CSS color as #rrggbb (alpha ignored): "rgb(…)" or, from color-mix(), "color(srgb …)". */
function toHex(color: string) {
  const numbers = color.match(/[\d.]+/g)!.map(Number);
  const channels = color.startsWith('color(') ? numbers.slice(0, 3).map((c) => Math.round(c * 255)) : numbers.slice(0, 3);
  return '#' + channels.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Color of the bar whose label is `name`. */
async function barFill(page: Page, name: string, nth = 0) {
  return toHex(await bar(page, name, nth).locator('.bar-track').evaluate((track) => getComputedStyle(track).backgroundColor));
}

/** Whether the bar is drawn with the closed hatch. */
async function isHatched(page: Page, name: string) {
  const image = await bar(page, name).locator('.bar-track').evaluate((track) => getComputedStyle(track).backgroundImage);
  return image.includes('repeating-linear-gradient');
}

function luminance(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
}

const EPIC_BAND = 'rgba(0, 122, 255, 0.1)'; // epic color (systemBlue) at 10%, light appearance

// These tests predate the period selector and use fixed dates: show every date, whatever
// today is (the period has its own tests in period.mocked.spec.ts).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
});

test.describe('Gantt (mocked API)', () => {
  test('shows the configured group and only the collapsed top-level rows', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page).toHaveTitle('Nornir');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nornir');
    const groupLink = page.getByRole('link', { name: config.group });
    await expect(groupLink).toHaveAttribute('href', `${config.gitlabUrl}/${config.group}`);

    for (const name of ['[Milestone] Sprint 1', 'Main epic']) {
      await expect(page.getByTitle(name).first()).toBeVisible();
    }
    // Everything starts collapsed: no child row is rendered.
    await expect(page.getByTitle('Shared issue')).toHaveCount(0);
    await expect(page.getByTitle('Standalone issue')).toHaveCount(0);
    await expect(page.getByTitle('Deep issue')).toHaveCount(0);
  });

  test('a nested epic is also listed at the top level', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // Only the top-level copy is visible while its parent is collapsed.
    await expect(page.getByTitle('Child epic')).toHaveCount(1);
    await page.getByTitle('Child epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Deep issue')).toHaveCount(1);

    // Expanding the parent shows the nested epic in its hierarchy too.
    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Child epic')).toHaveCount(2);
  });

  test('expanding and collapsing a group shows and hides its children', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const epicRow = page.getByTitle('Main epic').locator('..');
    await epicRow.getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
    await expect(page.getByTitle('Shared issue')).toHaveCount(1);

    // The issue attached to both the epic and the milestone also shows up under the milestone.
    await page.getByTitle('[Milestone] Sprint 1').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Shared issue')).toHaveCount(2);

    await epicRow.getByRole('button', { name: 'Collapse' }).click();
    await expect(page.getByTitle('Standalone issue')).toHaveCount(0);
    await expect(page.getByTitle('Shared issue')).toHaveCount(1); // the copy under the milestone remains
  });

  test('expanded children are indented right below their parent, with tree connectors', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    // listRows() reads the DOM once: wait for the children to be rendered first.
    await expect(page.getByTitle('Standalone issue')).toBeVisible();

    let rows = await listRows(page);
    let parent = rows.findIndex((r) => r.name === 'Main epic');
    expect(rows.slice(parent + 1, parent + 4).map((r) => [r.name, r.depth, r.last])).toEqual([
      ['Shared issue', 1, false],
      ['Standalone issue', 1, false],
      ['Child epic', 1, true],
    ]);
    expect(rows[parent + 1].nameX).toBeGreaterThan(rows[parent].nameX);
    // The top-level copy of the nested epic stays at depth 0, after the group.
    expect(rows.filter((r) => r.name === 'Child epic').map((r) => r.depth)).toEqual([1, 0]);

    // One more level: the nested epic's child comes right below it, further indented.
    await page.locator('.task-list-row[data-depth="1"]', { has: page.getByTitle('Child epic') }).getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Deep issue')).toBeVisible();
    rows = await listRows(page);
    parent = rows.findIndex((r) => r.name === 'Child epic' && r.depth === 1);
    expect(rows[parent + 1]).toMatchObject({ name: 'Deep issue', depth: 2, last: true });
    expect(rows[parent + 1].nameX).toBeGreaterThan(rows[parent].nameX);
  });

  test("rows of an expanded group are tinted in the group's color, in the list and the timeline", async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const epicRow = page.getByTitle('Main epic').locator('..');
    await epicRow.getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();

    const rows = await listRows(page);
    const child = rows.findIndex((r) => r.name === 'Standalone issue');
    expect(rows[child].background).toContain(EPIC_BAND);
    expect(rows.find((r) => r.name === 'Main epic')!.background).not.toContain(EPIC_BAND);

    // The timeline side of the same row.
    const timelineRow = page.locator('.gantt-row', { has: page.getByTitle('Standalone issue') }).locator('.timeline-row');
    expect(await timelineRow.evaluate((row) => getComputedStyle(row).backgroundImage)).toContain(EPIC_BAND);

    await epicRow.getByRole('button', { name: 'Collapse' }).click();
    await expect(timelineRow).toHaveCount(0);
    // The epic row itself is not tinted.
    const epicTimeline = page.locator('.gantt-row', { has: page.getByTitle('Main epic') }).locator('.timeline-row');
    expect(await epicTimeline.evaluate((row) => getComputedStyle(row).backgroundImage)).not.toContain(EPIC_BAND);
  });

  test('child bars are lighter than top-level bars', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.locator('.bar-label', { hasText: 'Child epic' })).toHaveCount(2);

    // Same type (epic): the nested one (first, under Main epic) vs its top-level copy.
    const nested = await barFill(page, 'Child epic', 0);
    const topLevel = await barFill(page, 'Child epic', 1);
    expect(luminance(nested)).toBeGreaterThan(luminance(topLevel));
    expect(topLevel).toBe('#ff9500'); // the top-level copy: at risk (orange), not toned down
  });

  test('the list only shows item names', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page.locator('.task-list-header')).toHaveText('Name');
    await expect(page.getByText('From', { exact: true })).toHaveCount(0);
    await expect(page.getByText('To', { exact: true })).toHaveCount(0);
    // No date is written in the list rows.
    await expect(page.locator('.task-list-row').first()).toBeVisible();
    await expect(page.locator('.task-list-row', { hasText: '2026' })).toHaveCount(0);
  });

  test('hovering a bar shows its dates in the tooltip', async ({ page }) => {
    // The chart opens centered on today: pick a day where the hovered bar is on screen.
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');

    const label = await page.locator('.bar-label', { hasText: 'Main epic' }).boundingBox();
    await page.mouse.move(label!.x + label!.width / 2, label!.y + label!.height / 2);
    const tooltip = page.locator('.gantt-tooltip');
    await expect(tooltip).toContainText('Main epic');
    await expect(tooltip).toContainText('From Oct 1, 2026 to Dec 1, 2026');
    await expect(tooltip).toContainText('50% complete');
  });

  test('marks today with a line and centers the chart on it', async ({ page }) => {
    // Thursday at noon: the middle of its week column.
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');

    let position = await todayLinePosition(page);
    expect(position.fractionInColumn).toBeCloseTo(0.5, 2);
    expect(Math.abs(position.offsetFromCenter)).toBeLessThanOrEqual(position.columnWidth);

    // Switching view mode centers again, and the line follows the new columns.
    await page.getByRole('radio', { name: 'Month' }).click();
    await expect.poll(async () => (await todayLinePosition(page)).fractionInColumn).toBeCloseTo(14.5 / 31, 2);
    position = await todayLinePosition(page);
    expect(Math.abs(position.offsetFromCenter)).toBeLessThanOrEqual(position.columnWidth);
  });

  test('the today line stays when rows are expanded', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');
    await expect(page.locator('.today-line')).toHaveCount(1);

    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
    const line = page.locator('.today-line');
    await expect(line).toHaveCount(1);
    // The line spans every visible row, including the new ones.
    const rows = await page.locator('.task-list-row').count();
    const height = await rowHeight(page);
    await expect.poll(async () => (await line.boundingBox())!.height).toBeGreaterThanOrEqual(rows * height);
  });

  test('switches view mode', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    for (const label of ['Day', 'Month', 'Week']) {
      const segment = page.getByRole('radio', { name: label });
      await segment.click();
      await expect(segment).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
    }
  });

  test('Refresh bypasses the cache and keeps expanded rows', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Main epic')).toBeVisible();
    expect(calls.at(-1)).not.toContain('refresh=1');

    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => calls.at(-1)).toContain('refresh=1');
    // The rows expanded before the refresh stay expanded.
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
  });

  test('shows the backend error', async ({ page }) => {
    await mockApi(page, { status: 404, body: { error: 'group not found or not accessible' } });
    await page.goto('/');
    const banner = page.getByRole('alert');
    await expect(banner).toContainText("Couldn't load the chart");
    await expect(banner).toContainText('group not found or not accessible');
    await expect(banner.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('explains when the server does not answer', async ({ page }) => {
    await mockApi(page, { status: 502, body: '<html>Bad Gateway</html>' });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('The Nornir server is not responding');
  });

  test('shows a message when the group is empty', async ({ page }) => {
    await mockApi(page, { body: [] });
    await page.goto('/');
    await expect(page.getByText('No items in this group')).toBeVisible();
  });

  test('the Today button brings today back to the center', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');
    await expect(page.locator('.today-line')).toHaveCount(1);

    // Scroll the timeline all the way to the left, as a user would.
    await page.locator('.gantt-scroll').evaluate((scroller) => (scroller.scrollLeft = 0));
    await expect.poll(async () => Math.abs((await todayLinePosition(page)).offsetFromCenter)).toBeGreaterThan(200);

    await page.getByRole('button', { name: 'Today' }).click();
    await expect
      .poll(async () => {
        const position = await todayLinePosition(page);
        return Math.abs(position.offsetFromCenter) <= position.columnWidth;
      })
      .toBe(true);
  });

  test('shows a skeleton while loading, then the time of the last update', async ({ page }) => {
    await mockApi(page, { body: tree, delayMs: 800 });
    await page.goto('/');

    await expect(page.getByLabel('Loading')).toBeVisible();
    await expect(page.getByTitle('Main epic')).toBeVisible();
    await expect(page.getByLabel('Loading')).toHaveCount(0);
    await expect(page.locator('.toolbar')).toContainText(/Updated at \d{1,2}:\d{2}/);
  });

  test('follows the dark appearance of the system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Main epic')).toBeVisible();

    const card = await page.locator('.gantt-chart').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(card).toBe('rgb(28, 28, 30)');
    // Bars use the dark variants of the system colors.
    expect(await barFill(page, 'Main epic')).toBe('#ff453a'); // late
  });

  test.describe('appearance', () => {
    const cardColor = (page: Page) =>
      page.locator('.gantt-chart').evaluate((el) => getComputedStyle(el).backgroundColor);

    async function chooseAppearance(page: Page, label: 'Automatic' | 'Light' | 'Dark') {
      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('menuitemradio', { name: label }).click();
      await expect(page.getByRole('menu')).toHaveCount(0);
    }

    test('Light overrides a dark system', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();
      expect(await cardColor(page)).toBe('rgb(28, 28, 30)');

      await chooseAppearance(page, 'Light');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect.poll(() => cardColor(page)).toBe('rgb(255, 255, 255)');
      await expect.poll(() => barFill(page, 'Main epic')).toBe('#ff3b30'); // late, light palette
      await expect(page.getByRole('button', { name: 'Appearance' })).toHaveAttribute('data-appearance', 'light');
    });

    test('Dark overrides a light system and is remembered', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();

      await chooseAppearance(page, 'Dark');
      await expect.poll(() => cardColor(page)).toBe('rgb(28, 28, 30)');
      await expect.poll(() => barFill(page, 'Main epic')).toBe('#ff453a'); // late, dark palette

      await page.reload();
      // Applied before the app renders (no flash), then kept by the app.
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByTitle('Main epic')).toBeVisible();
      expect(await cardColor(page)).toBe('rgb(28, 28, 30)');
      await page.getByRole('button', { name: 'Appearance' }).click();
      await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    });

    test('Automatic follows the system while the page is open', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Appearance' })).toHaveAttribute('data-appearance', 'system');
      expect(await cardColor(page)).toBe('rgb(255, 255, 255)');

      await page.emulateMedia({ colorScheme: 'dark' });
      await expect.poll(() => cardColor(page)).toBe('rgb(28, 28, 30)');
      await expect.poll(() => barFill(page, 'Main epic')).toBe('#ff453a'); // late, dark palette
    });

    test('the menu works with the keyboard and closes on Escape or a click outside', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      const button = page.getByRole('button', { name: 'Appearance' });

      await button.click();
      const menu = page.getByRole('menu', { name: 'Appearance' });
      await expect(menu).toBeVisible();
      await expect(page.getByRole('menuitemradio')).toHaveText(['Automatic', 'Light', 'Dark']);
      await expect(page.getByRole('menuitemradio', { name: 'Automatic' })).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(button).toBeFocused();

      // Arrow keys move through the items; Enter picks one.
      await button.click();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

      await button.click();
      await expect(menu).toBeVisible();
      await page.getByRole('heading', { level: 1 }).click();
      await expect(menu).toHaveCount(0);
    });
  });

  test('epic and milestone bars show their expected (linear) progress under the real one', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Main epic')).toBeVisible();

    // The layers of the bar whose label is the given name: track, linear progress, then solid progress.
    const layers = (name: string) =>
      bar(page, name).evaluate((element) =>
        [...element.querySelectorAll(':scope > div')].map((layer) => ({
          cls: layer.className,
          width: layer.getBoundingClientRect().width,
          opacity: Number(getComputedStyle(layer).opacity),
        })),
      );

    // Main epic: 50% done, 80% expected → the linear layer is wider than the progress.
    await expect.poll(async () => (await layers('Main epic'))[1]?.cls).toBe('linear-progress');
    const [track, linear, progress] = await layers('Main epic');
    expect(linear.width / track.width).toBeCloseTo(0.8, 2);
    expect(progress.width / track.width).toBeCloseTo(0.5, 2);
    // Opacities: transparent track < linear progress < solid progress.
    expect(track.opacity).toBeLessThan(linear.opacity);
    expect(linear.opacity).toBeLessThan(progress.opacity);

    // Sprint 1: 50% done, 20% expected → ahead, the linear layer is under the progress.
    const sprint = await layers('[Milestone] Sprint 1');
    expect(sprint[1].width / sprint[0].width).toBeCloseTo(0.2, 2);

    // Issues keep their plain bar, without linear layer.
    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
    await expect(bar(page, 'Standalone issue').locator('.linear-progress')).toHaveCount(0);
  });

  test('the tooltip tells whether a group is ahead or behind schedule', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Main epic')).toBeVisible();

    const hover = async (name: string) => {
      await page.mouse.move(0, 0); // leave the previous bar so its tooltip closes
      await expect(page.locator('.gantt-tooltip')).toHaveCount(0);
      const label = (await page.locator('.bar-label', { hasText: name }).first().boundingBox())!;
      await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
    };
    await hover('Main epic');
    await expect(page.locator('.gantt-tooltip')).toContainText('Expected 80% · 30% behind');
    // The status color also applies to the tooltip's progress bar.
    await expect
      .poll(() => page.locator('.gantt-tooltip .progress-value').evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(255, 59, 48)');
    await hover('[Milestone] Sprint 1');
    await expect(page.locator('.gantt-tooltip')).toContainText('Expected 20% · On track · 30% ahead');
  });

  test('epic and milestone bars are colored by schedule status', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Main epic')).toBeVisible();

    // Main epic 50% vs 80% expected → late; Sprint 1 50% vs 20% → on track;
    // Child epic 0% vs 3% → at risk.
    expect(await barFill(page, 'Main epic')).toBe('#ff3b30');
    expect(await barFill(page, '[Milestone] Sprint 1')).toBe('#34c759');
    expect(await barFill(page, 'Child epic')).toBe('#ff9500');
    await expect(page.locator('.task-list-row', { has: page.getByTitle('Main epic') })).toHaveAttribute('data-schedule', 'late');
    await expect(page.locator('.task-list-row', { has: page.getByTitle('[Milestone] Sprint 1') })).toHaveAttribute('data-schedule', 'on-track');
    await expect(page.locator('.task-list-row', { has: page.getByTitle('Child epic') })).toHaveAttribute('data-schedule', 'at-risk');

    // The linear layer follows the status color of its bar.
    const linearFill = await bar(page, 'Main epic').locator('.linear-progress').evaluate((layer) => getComputedStyle(layer).backgroundColor);
    expect(toHex(linearFill)).toBe('#ff3b30');

    // Issues keep their type color (teal), never a status color.
    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
    expect(await barFill(page, 'Standalone issue')).not.toMatch(/#34c759|#ff9500|#ff3b30/);
    await expect(page.locator('.task-list-row', { has: page.getByTitle('Standalone issue') })).not.toHaveAttribute('data-schedule', /.+/);
  });

  test('the 5-point threshold: exactly 5 behind is orange, more is red', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const group = (id: string, name: string, progress: number, linearProgress: number) => ({
      id, name, type: 'epic', start: '2026-10-01', end: '2026-10-31', progress, linearProgress,
      children: [{ id: `${id}-issue`, name: `${name} issue`, type: 'issue', start: '2026-10-01', end: '2026-10-05', progress: 0, linearProgress: 0 }],
    });
    await mockApi(page, {
      body: [
        group('a', 'Exactly on track', 40, 40),
        group('b', 'Five points behind', 35, 40),
        group('c', 'Just over five', 34.9, 40),
      ],
    });
    await page.goto('/');
    await expect(page.getByTitle('Just over five')).toBeVisible();

    expect(await barFill(page, 'Exactly on track')).toBe('#34c759');
    expect(await barFill(page, 'Five points behind')).toBe('#ff9500');
    expect(await barFill(page, 'Just over five')).toBe('#ff3b30');
  });

  test('closed items are grayed out and hatched', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Main epic')).toBeVisible();
    const row = (name: string) => page.locator('.task-list-row', { has: page.getByTitle(name) }).first();
    const nameColor = (name: string) => row(name).locator('.task-list-name').evaluate((el) => getComputedStyle(el).color);

    // The closed milestone: hatched bar, no schedule color nor linear layer, grayed name.
    await page.getByRole('button', { name: 'Closed' }).click(); // closed items are hidden by default
    expect(await isHatched(page, '[Milestone] Empty sprint')).toBe(true);
    await expect(row('[Milestone] Empty sprint')).toHaveAttribute('data-closed', 'true');
    await expect(row('[Milestone] Empty sprint')).not.toHaveAttribute('data-schedule', /.+/);
    expect(await nameColor('[Milestone] Empty sprint')).not.toBe(await nameColor('Main epic'));
    await expect(bar(page, 'Empty sprint').locator('.linear-progress')).toHaveCount(0);

    // A closed issue is hatched too, an open one keeps its color.
    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
    expect(await isHatched(page, 'Done issue')).toBe(true);
    expect(await isHatched(page, 'Standalone issue')).toBe(false);

    // The tooltip says it is closed, with its real progress.
    // Hover the start of the bar: its label (centered) may be beyond the visible area.
    const box = (await bar(page, 'Empty sprint').boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    const tooltip = page.locator('.gantt-tooltip');
    await expect(tooltip).toContainText('Closed');
    await expect(tooltip).toContainText('0% complete');
    await expect(tooltip).not.toContainText('Expected');
  });

  test.describe('closed items filter', () => {
    const closedButton = (page: Page) => page.getByRole('button', { name: 'Closed' });

    test('closed items are hidden by default and shown with the Closed button', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();
      await expect(closedButton(page)).toHaveAttribute('aria-pressed', 'false');

      await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
      await expect(page.getByTitle('Standalone issue')).toBeVisible();
      await expect(page.getByTitle('Done issue')).toHaveCount(0);
      await expect(page.getByTitle('[Milestone] Empty sprint')).toHaveCount(0);

      await closedButton(page).click();
      await expect(closedButton(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTitle('Done issue')).toBeVisible();
      await expect(page.getByTitle('[Milestone] Empty sprint')).toBeVisible();

      await closedButton(page).click();
      await expect(page.getByTitle('Done issue')).toHaveCount(0);
      await expect(page.getByTitle('[Milestone] Empty sprint')).toHaveCount(0);
    });

    test('the choice is remembered', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await closedButton(page).click();
      await expect(page.getByTitle('[Milestone] Empty sprint')).toBeVisible();

      await page.reload();
      await expect(page.getByTitle('[Milestone] Empty sprint')).toBeVisible();
      await expect(closedButton(page)).toHaveAttribute('aria-pressed', 'true');
    });

    test('a closed parent hides its whole subtree', async ({ page }) => {
      await mockApi(page, {
        body: [
          {
            id: 'E9', name: 'Closed epic', type: 'epic', closed: true, start: '2026-10-01', end: '2026-10-20', progress: 50, linearProgress: 0,
            children: [{ id: 'I9', name: 'Open leftover', type: 'issue', start: '2026-10-01', end: '2026-10-05', progress: 0, linearProgress: 0 }],
          },
          { id: 'E8', name: 'Open epic', type: 'epic', start: '2026-10-01', end: '2026-10-20', progress: 0, linearProgress: 0 },
        ],
      });
      await page.goto('/');
      await expect(page.getByTitle('Open epic')).toBeVisible();
      await expect(page.getByTitle('Closed epic')).toHaveCount(0);

      await closedButton(page).click();
      await page.getByTitle('Closed epic').locator('..').getByRole('button', { name: 'Expand' }).click();
      await expect(page.getByTitle('Open leftover')).toBeVisible();
    });

    test('showing closed items does not move the view', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
      // The closed epic starts months earlier: showing it moves the start of the date range.
      await mockApi(page, {
        body: [
          { id: 'E1', name: 'Current epic', type: 'epic', start: '2026-10-01', end: '2026-10-31', progress: 0, linearProgress: 0 },
          { id: 'E0', name: 'Old epic', type: 'epic', closed: true, start: '2026-05-01', end: '2026-06-15', progress: 100, linearProgress: 100 },
        ],
      });
      await page.goto('/');
      await expect(page.getByTitle('Current epic')).toBeVisible();
      await page.waitForTimeout(700); // let the initial centering finish
      const before = await todayLinePosition(page);
      expect(Math.abs(before.offsetFromCenter)).toBeLessThanOrEqual(before.columnWidth);

      await closedButton(page).click();
      await expect(page.getByTitle('Old epic')).toBeVisible();
      // Today stays where it was on screen, instead of the view jumping months back.
      await expect
        .poll(async () => Math.abs((await todayLinePosition(page)).offsetFromCenter - before.offsetFromCenter))
        .toBeLessThanOrEqual(2);
      await page.waitForTimeout(700);
      const after = await todayLinePosition(page);
      expect(Math.abs(after.offsetFromCenter - before.offsetFromCenter)).toBeLessThanOrEqual(2);
    });

    test('says so when everything is closed', async ({ page }) => {
      await mockApi(page, {
        body: [{ id: 'E7', name: 'Finished epic', type: 'epic', closed: true, start: '2026-10-01', end: '2026-10-20', progress: 100, linearProgress: 0 }],
      });
      await page.goto('/');
      await expect(page.getByText('Everything is closed')).toBeVisible();

      await page.getByRole('button', { name: 'Show closed items' }).click();
      await expect(page.getByTitle('Finished epic')).toBeVisible();
      await expect(page.getByText('Everything is closed')).toHaveCount(0);
    });
  });

  test.describe('missing dates', () => {
    // Today is 2026-10-15: the backend puts rows without dates on today only.
    const undatedTree = [
      {
        id: 'E1', name: 'Undated epic', type: 'epic', noStartDate: true, noDueDate: true, start: '2026-10-15', end: '2026-10-16', progress: 0, linearProgress: 50,
        children: [{ id: 'I1', name: 'Dated issue', type: 'issue', start: '2026-10-05', end: '2026-10-25', progress: 0, linearProgress: 50 }],
      },
      {
        id: 'E2', name: 'Dated epic', type: 'epic', start: '2026-10-01', end: '2026-10-31', progress: 0, linearProgress: 50,
        children: [{ id: 'I3', name: 'Other issue', type: 'issue', start: '2026-10-05', end: '2026-10-25', progress: 0, linearProgress: 50 }],
      },
      { id: 'I2', name: 'Due date only', type: 'issue', noStartDate: true, start: '2026-10-06', end: '2026-10-20', progress: 0, linearProgress: 50 },
    ];

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
      await mockApi(page, { body: undatedTree });
      await page.goto('/');
      await expect(page.getByTitle('Undated epic')).toBeVisible();
    });

    const row = (page: Page, name: string) => page.locator('.task-list-row', { has: page.getByTitle(name, { exact: true }) });

    test('a warning sign next to the name says the dates are missing', async ({ page }) => {
      const warning = row(page, 'Undated epic').getByRole('img', { name: 'No dates in GitLab' });
      await expect(warning).toBeVisible();
      await expect(warning).toHaveAttribute('title', 'No dates in GitLab');
      await expect(row(page, 'Due date only').getByRole('img', { name: 'No start date in GitLab' })).toBeVisible();
      await expect(row(page, 'Dated epic').getByRole('img')).toHaveCount(0);
    });

    test('the bar is gray with a dashed outline and no schedule', async ({ page }) => {
      const undated = page.locator('.bar[data-undated]');
      await expect(undated).toHaveCount(2); // the epic and the issue with a due date only
      expect(await barFill(page, 'Undated epic')).toBe('#aeaeb2');
      await expect(undated.first().locator('.bar-track')).toHaveCSS('outline-style', 'dashed');

      // No expected-progress layer and no schedule color, unlike a dated epic that is late.
      await expect(undated.first().locator('.linear-progress')).toHaveCount(0);
      await expect(page.locator('.linear-progress')).toHaveCount(1);
      await expect(row(page, 'Undated epic')).not.toHaveAttribute('data-schedule');
      await expect(row(page, 'Dated epic')).toHaveAttribute('data-schedule', 'late');
    });

    test('the tooltip says the dates are missing instead of judging the schedule', async ({ page }) => {
      const box = (await page.locator('.bar[data-undated] .bar-track').first().boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const tooltip = page.locator('.gantt-tooltip');
      await expect(tooltip).toContainText('No dates in GitLab');
      await expect(tooltip).not.toContainText('Expected');
    });
  });

  test.describe('filters', () => {
    /** Names of the visible list rows, in order. */
    async function rowNames(page: Page) {
      return page.locator('.task-list-row .task-list-cell').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('title')));
    }

    type TypeName = 'Milestones' | 'Epics' | 'Issues';

    /** Presses (or unpresses) the toggle of an item type. */
    async function toggleType(page: Page, type: TypeName) {
      await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: type }).click();
    }

    /** Unpresses every type but the given ones (they all start pressed). */
    async function showOnly(page: Page, ...types: TypeName[]) {
      for (const type of ['Milestones', 'Epics', 'Issues'] as const) {
        if (!types.includes(type)) await toggleType(page, type);
      }
    }

    /** Opens the Labels menu, toggles the given labels, and closes it. */
    async function pickLabels(page: Page, ...labels: string[]) {
      await page.getByRole('button', { name: /^Labels/ }).click();
      const popover = page.getByRole('dialog', { name: 'Labels' });
      for (const label of labels) await popover.getByRole('option', { name: label, exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
    }

    const expandRow = (page: Page, name: string) =>
      page.getByTitle(name).first().locator('..').getByRole('button', { name: 'Expand' }).click();

    const TOP_ROWS = ['[Milestone] Sprint 1', 'Main epic', 'Child epic'];

    test('every type starts pressed; unpressing a type hides it', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();
      const show = page.getByRole('group', { name: 'Show' });
      for (const type of ['Milestones', 'Epics', 'Issues']) {
        await expect(show.getByRole('button', { name: type })).toHaveAttribute('aria-pressed', 'true');
      }
      expect(await rowNames(page)).toEqual(TOP_ROWS);
      await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);

      await showOnly(page, 'Milestones');
      await expect(show.getByRole('button', { name: 'Epics' })).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Sprint 1']);

      // Pressing them again shows everything.
      await toggleType(page, 'Epics');
      await toggleType(page, 'Issues');
      await expect.poll(() => rowNames(page)).toEqual(TOP_ROWS);
    });

    test('with no type pressed, nothing is shown until Clear filters', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();

      await showOnly(page);
      await expect(page.getByText('No matching items')).toBeVisible();
      await expect(page.locator('.task-list-row')).toHaveCount(0);

      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect.poll(() => rowNames(page)).toEqual(TOP_ROWS);
      await expect(page.getByRole('button', { name: 'Issues' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('Epics with a label shows those epics, each with its whole content', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();

      await showOnly(page, 'Epics');
      await pickLabels(page, 'team-a');
      await expect(page.getByRole('button', { name: 'Labels: team-a' })).toHaveAttribute('data-active', 'true');
      await expect.poll(() => rowNames(page)).toEqual(['Main epic']);

      // Its children show up too, although they don't carry the label.
      await expandRow(page, 'Main epic');
      await expect.poll(() => rowNames(page)).toEqual(['Main epic', 'Shared issue', 'Standalone issue', 'Child epic']);
    });

    test('an epic nested in another one is listed once', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();

      await showOnly(page, 'Epics');
      await pickLabels(page, 'backend');
      await expect.poll(() => rowNames(page)).toEqual(['Child epic']);
    });

    test('Issues are listed flat, once each', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();

      // "Shared issue" sits under Sprint 1 and under Main epic, "Deep issue" under both copies
      // of Child epic: each is listed once.
      await showOnly(page, 'Issues');
      await expect.poll(() => rowNames(page)).toEqual(['Shared issue', 'Standalone issue', 'Deep issue']);

      await pickLabels(page, 'frontend');
      await expect.poll(() => rowNames(page)).toEqual(['Standalone issue', 'Deep issue']);
    });

    test('a label alone shows every kind of item carrying it, milestones by their content', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();

      // Milestones first, then epics, then issues. Sprint 1 holds a "backend" issue.
      await pickLabels(page, 'backend');
      await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Sprint 1', 'Child epic', 'Shared issue']);

      // Any of the labels: "bug" adds Deep issue.
      await pickLabels(page, 'bug');
      await expect(page.getByRole('button', { name: 'Labels: 2 labels' })).toBeVisible();
      await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Sprint 1', 'Child epic', 'Shared issue', 'Deep issue']);
    });

    test('search finds items of every type by name', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();

      // Case and accents don't matter.
      await page.getByRole('textbox', { name: 'Search' }).fill('ÉPIC');
      await expect.poll(() => rowNames(page)).toEqual(['Main epic', 'Child epic']);
      await page.getByRole('textbox', { name: 'Search' }).fill('shared');
      await expect.poll(() => rowNames(page)).toEqual(['Shared issue']);

      // Combined with a type.
      await page.getByRole('textbox', { name: 'Search' }).fill('i');
      await showOnly(page, 'Milestones');
      await expect.poll(() => rowNames(page)).toEqual(['[Milestone] Sprint 1']);

      await page.getByRole('button', { name: 'Clear search' }).click();
      await expect(page.getByRole('textbox', { name: 'Search' })).toHaveValue('');
    });

    test('an issue listed on its own and under its epic keeps separate rows', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();

      await showOnly(page, 'Epics', 'Issues');
      await expect
        .poll(() => rowNames(page))
        .toEqual(['Main epic', 'Child epic', 'Shared issue', 'Standalone issue', 'Deep issue']);

      // Expanding the nested epic in Main epic doesn't expand the top-level Child epic.
      await expandRow(page, 'Main epic');
      await expandRow(page, 'Child epic');
      await expect
        .poll(() => rowNames(page))
        .toEqual(['Main epic', 'Shared issue', 'Standalone issue', 'Child epic', 'Deep issue', 'Child epic', 'Shared issue', 'Standalone issue', 'Deep issue']);
      await expect(page.locator('.task-list-row[data-expanded]')).toHaveCount(2);
    });

    test('expanded rows stay expanded through filtering', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expandRow(page, 'Main epic');
      await expect(page.getByTitle('Standalone issue')).toBeVisible();

      await showOnly(page, 'Epics');
      await expect.poll(() => rowNames(page)).toEqual(['Main epic', 'Shared issue', 'Standalone issue', 'Child epic', 'Child epic']);

      await page.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect
        .poll(() => rowNames(page))
        .toEqual(['[Milestone] Sprint 1', 'Main epic', 'Shared issue', 'Standalone issue', 'Child epic', 'Child epic']);
    });

    test('says so when nothing matches, and Clear filters shows everything again', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();

      // Sprint 1 holds no "bug" item.
      await showOnly(page, 'Milestones');
      await pickLabels(page, 'bug');
      await expect(page.getByText('No matching items')).toBeVisible();
      await expect(page.locator('.gantt-chart')).toHaveCount(0);

      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect.poll(() => rowNames(page)).toEqual(TOP_ROWS);
      await expect(page.getByRole('button', { name: 'Milestones' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Labels', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);
    });

    test('the Labels menu lists the labels in the chart first, then the other group labels', async ({ page }) => {
      await mockApi(page);
      await page.goto('/');
      await page.getByRole('button', { name: 'Labels' }).click();
      const popover = page.getByRole('dialog', { name: 'Labels' });

      // "bug" only exists on an item (a project label); "security" is used by no item.
      await expect(popover.locator('.menu-header, [role="option"]')).toHaveText([
        'In this chart', 'backend', 'bug', 'frontend', 'team-a', 'Other labels', 'security',
      ]);
      // Each label shows its GitLab color.
      await expect(popover.getByRole('option', { name: 'backend' }).locator('.label-dot')).toHaveCSS('background-color', 'rgb(66, 139, 202)');
      // Short lists have no search field.
      await expect(popover.getByRole('textbox')).toHaveCount(0);

      // Escape closes it and gives the focus back to its button.
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Labels' })).toBeFocused();
    });

    test('long label lists can be searched', async ({ page }) => {
      const many = Array.from({ length: 12 }, (_, i) => ({ title: `area::${i}`, color: '#6699cc' }));
      await mockApi(page, undefined, { body: [...many, { title: 'security', color: '#330066' }] });
      await page.goto('/');
      await page.getByRole('button', { name: 'Labels' }).click();
      const popover = page.getByRole('dialog', { name: 'Labels' });
      const search = popover.getByRole('textbox', { name: 'Search labels' });
      await expect(search).toBeFocused();

      await search.fill('SECU');
      await expect(popover.getByRole('option')).toHaveText(['security']);
      await search.fill('nothing like this');
      await expect(popover.getByText('No match')).toBeVisible();

      // ↓ from the search field goes to the options.
      await search.fill('area::1');
      await search.press('ArrowDown');
      await expect(popover.getByRole('option', { name: 'area::1', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(popover.getByRole('option', { name: 'area::1', exact: true })).toHaveAttribute('aria-selected', 'true');
    });

    test('without the group labels, the menu still lists the labels of the items', async ({ page }) => {
      await mockApi(page, undefined, { status: 500, body: { error: 'boom' } });
      await page.goto('/');
      await expect(page.getByTitle('Main epic')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);

      await page.getByRole('button', { name: 'Labels' }).click();
      await expect(page.getByRole('dialog', { name: 'Labels' }).getByRole('option')).toHaveText(['backend', 'bug', 'frontend', 'team-a']);
    });

    test('the filter popover follows the dark appearance', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await mockApi(page);
      await page.goto('/');
      await page.getByRole('button', { name: 'Labels' }).click();
      const popover = page.getByRole('dialog', { name: 'Labels' });
      await expect(popover).toBeVisible();
      const [background, text] = await popover.getByRole('option', { name: 'backend' }).evaluate((option) => [
        getComputedStyle(option.closest('.menu')!).backgroundColor,
        getComputedStyle(option).color,
      ]);
      const channels = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const light = (color: string) => channels(color).reduce((a, b) => a + b, 0) / 3;
      expect(light(background)).toBeLessThan(80);
      expect(light(text)).toBeGreaterThan(200);
    });
  });

  test.describe('full height', () => {
    // Ten plain epics, then an epic whose 30 issues can't fit on screen once expanded.
    const tallTree = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `E${i}`, name: `Epic ${i}`, type: 'epic', start: '2026-10-01', end: '2026-10-20', progress: 0, linearProgress: 0,
      })),
      {
        id: 'BIG', name: 'Big epic', type: 'epic', start: '2026-10-01', end: '2026-10-20', progress: 0, linearProgress: 0,
        children: Array.from({ length: 30 }, (_, i) => ({
          id: `I${i}`, name: `Issue ${i}`, type: 'issue', start: '2026-10-05', end: '2026-10-15', progress: 0, linearProgress: 0,
        })),
      },
    ];

    /** Vertical gap between a list row and the label of its bar (0 when they line up). */
    async function rowBarGap(page: Page, name: string) {
      const row = (await page.getByTitle(name).boundingBox())!;
      const label = (await page.locator('.bar-label', { hasText: new RegExp(`^${name}$`) }).boundingBox())!;
      return Math.abs(row.y + row.height / 2 - (label.y + label.height / 2));
    }

    async function wheelOverChart(page: Page, deltaY: number) {
      const box = (await page.locator('.gantt-chart').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, deltaY);
    }

    /** Distance between the bottom of the chart card and the bottom of the window. */
    async function gapBelowCard(page: Page) {
      const card = (await page.locator('.gantt-chart').boundingBox())!;
      return page.viewportSize()!.height - (card.y + card.height);
    }

    test('the chart grows with its rows, up to the window height', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-10T12:00:00'));
      await mockApi(page, { body: tallTree });
      await page.goto('/');
      await expect(page.getByTitle('Big epic')).toBeVisible();

      // Few rows: the card hugs them.
      const rows = await page.locator('.task-list-row').count();
      const card = (await page.locator('.gantt-chart').boundingBox())!;
      const header = (await page.locator('.task-list-header').boundingBox())!;
      expect(card.height).toBeLessThan(header.height + (rows + 1) * (await rowHeight(page)) + 20);
      expect(await gapBelowCard(page)).toBeGreaterThan(40); // well above the 16 px left when it is full

      // Too many rows: the card stops at the window bottom and the page doesn't scroll.
      await page.getByTitle('Big epic').locator('..').getByRole('button', { name: 'Expand' }).click();
      await expect(page.getByTitle('Issue 0')).toBeVisible(); // rows below the fold aren't rendered
      await expect.poll(async () => Math.abs((await gapBelowCard(page)) - 16)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true);

      // It follows the window size.
      const viewport = page.viewportSize()!;
      await page.setViewportSize({ width: viewport.width, height: viewport.height - 100 });
      await expect.poll(async () => Math.abs((await gapBelowCard(page)) - 16)).toBeLessThanOrEqual(2);
    });

    test('rows that do not fit scroll inside the chart, under a fixed header', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-10T12:00:00'));
      await mockApi(page, { body: tallTree });
      await page.goto('/');
      await page.getByTitle('Big epic').locator('..').getByRole('button', { name: 'Expand' }).click();
      await expect(page.getByTitle('Issue 0')).toBeVisible(); // rows below the fold aren't rendered
      await expect(page.getByTitle('Issue 29')).not.toBeInViewport();

      await wheelOverChart(page, 2000);
      await expect(page.getByTitle('Issue 29')).toBeInViewport();
      await expect(page.getByTitle('Epic 0')).not.toBeInViewport();
      // The list and the bars scroll together; the header and the page stay put.
      await expect.poll(() => rowBarGap(page, 'Issue 29')).toBeLessThanOrEqual(2);
      await expect(page.locator('.gantt-chart .gantt-header')).toBeInViewport();
      await expect(page.getByRole('banner')).toBeInViewport();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test('collapsing rows after scrolling down brings the first rows back', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-10T12:00:00'));
      await mockApi(page, { body: tallTree });
      await page.goto('/');
      await page.getByTitle('Big epic').locator('..').getByRole('button', { name: 'Expand' }).click();
      await expect(page.getByTitle('Issue 0')).toBeVisible(); // rows below the fold aren't rendered

      // Scroll by exactly 10 rows: "Big epic" becomes the first visible row.
      await wheelOverChart(page, 10 * (await rowHeight(page)));
      await expect(page.getByTitle('Epic 0')).not.toBeInViewport();
      await expect(page.getByTitle('Big epic')).toBeInViewport();
      await page.getByTitle('Big epic').locator('..').getByRole('button', { name: 'Collapse' }).click();

      await expect(page.getByTitle('Epic 0')).toBeInViewport();
      await expect.poll(() => rowBarGap(page, 'Epic 0')).toBeLessThanOrEqual(2);
      // The card shrinks back to its rows.
      await expect.poll(() => gapBelowCard(page)).toBeGreaterThan(40);
      await expect.poll(() => rowBarGap(page, 'Big epic')).toBeLessThanOrEqual(2);
    });

    test('the wheel does not move rows that already fit', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
      await mockApi(page);
      await page.goto('/');
      const label = page.locator('.bar-label', { hasText: 'Main epic' });
      const tooltip = page.locator('.gantt-tooltip');

      const hover = async () => {
        const box = (await label.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await expect(tooltip).toBeVisible();
        return (await tooltip.boundingBox())!.y;
      };
      const before = await hover();
      await page.mouse.move(5, 5);
      await expect(tooltip).toHaveCount(0);

      await wheelOverChart(page, 500);
      // The tooltip stays next to the bar.
      expect(Math.abs((await hover()) - before)).toBeLessThanOrEqual(2);
      expect(await rowBarGap(page, 'Main epic')).toBeLessThanOrEqual(2);
    });
  });
});
