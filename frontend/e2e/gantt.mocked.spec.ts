import { expect, Page, test } from '@playwright/test';
import { config, mockApi, tree } from './fixtures';

const LIST_WIDTH = 260;

/** Horizontal position of the today line, relative to its column and to the chart area. */
async function todayLinePosition(page: Page) {
  const line = page.locator('line.today-line');
  await expect(line).toHaveCount(1);
  const lineBox = (await line.boundingBox())!;
  const columnBox = (await page.locator('g.today rect').boundingBox())!;
  const chartBox = (await page.locator('.gantt-chart').boundingBox())!;
  const lineX = lineBox.x + lineBox.width / 2;
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
      background: getComputedStyle(row).backgroundColor,
    })),
  );
}

/** Fill of the bar whose label is `name` (the first one when the name is repeated). */
async function barFill(page: Page, name: string, nth = 0) {
  return page
    .locator('svg text', { hasText: name })
    .nth(nth)
    .evaluate((label) => label.parentElement!.querySelector('rect')!.getAttribute('fill')!);
}

function luminance(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
}

const EPIC_BAND = 'rgba(0, 122, 255, 0.1)'; // epic color (systemBlue) at 10%, light appearance

test.describe('Gantt (mocked API)', () => {
  test('shows the configured group and only the collapsed top-level rows', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page).toHaveTitle('Nornir');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nornir');
    const groupLink = page.getByRole('link', { name: config.group });
    await expect(groupLink).toHaveAttribute('href', `${config.gitlabUrl}/${config.group}`);

    for (const name of ['[Milestone] Sprint 1', '[Milestone] Empty sprint', 'Main epic']) {
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
    expect(rows[child].background).toBe(EPIC_BAND);
    expect(rows.find((r) => r.name === 'Main epic')!.background).not.toBe(EPIC_BAND);

    // The child's timeline row is the grid rect at its index.
    const timelineRow = page.locator(`g.rows rect[y="${child * (await rowHeight(page))}"]`);
    const fill = () => timelineRow.evaluate((rect) => getComputedStyle(rect).fill);
    await expect.poll(fill).toBe(EPIC_BAND);

    await epicRow.getByRole('button', { name: 'Collapse' }).click();
    await expect.poll(fill).not.toBe(EPIC_BAND);
  });

  test('child bars are lighter than top-level bars', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.locator('svg text', { hasText: 'Child epic' })).toHaveCount(2);

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
    await expect(page.locator('.task-list')).not.toContainText('2026');
  });

  test('hovering a bar shows its dates in the tooltip', async ({ page }) => {
    // The chart opens centered on today: pick a day where the hovered bar is on screen.
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');

    // The label doesn't receive pointer events: move the mouse onto it, over the bar.
    const label = await page.locator('svg text', { hasText: 'Main epic' }).boundingBox();
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
    await expect(page.locator('line.today-line')).toHaveCount(1);

    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
    const line = page.locator('line.today-line');
    await expect(line).toHaveCount(1);
    // The line spans every visible row, including the new ones.
    const rows = await page.locator('.task-list-row').count();
    const height = await rowHeight(page);
    await expect.poll(async () => Number(await line.getAttribute('y2'))).toBeGreaterThanOrEqual(rows * height);
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
    await expect(page.locator('line.today-line')).toHaveCount(1);
    await page.waitForTimeout(700); // let the initial centering finish

    // Scroll the timeline all the way to the left, as a user would. A real scroll sends a
    // stream of events and the library ignores every other one, so send it until it moves.
    await expect
      .poll(async () => {
        await page.locator('.gantt-chart div').evaluateAll((divs) => {
          const scrollbar = divs.find((d) => getComputedStyle(d).overflowX === 'auto')!;
          scrollbar.scrollLeft = 0;
          scrollbar.dispatchEvent(new Event('scroll', { bubbles: true }));
        });
        return Math.abs((await todayLinePosition(page)).offsetFromCenter);
      })
      .toBeGreaterThan(200);

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

    // The bar group whose label is the given name: track, linear progress, then solid progress.
    const layers = (name: string) =>
      page.locator('svg text', { hasText: name }).first().evaluate((label) => {
        const bar = label.parentElement!.querySelector('._1KJ6x')!;
        const rects = [...bar.querySelectorAll(':scope > rect')] as SVGRectElement[];
        return rects.slice(0, 3).map((rect) => ({
          cls: rect.getAttribute('class') ?? '',
          width: Number(rect.getAttribute('width')),
          opacity: Number(getComputedStyle(rect).opacity),
        }));
      });

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
    const issueHasLinear = await page
      .locator('svg text', { hasText: 'Standalone issue' })
      .evaluate((label) => !!label.parentElement!.querySelector('rect.linear-progress'));
    expect(issueHasLinear).toBe(false);
  });

  test('the tooltip tells whether a group is ahead or behind schedule', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Main epic')).toBeVisible();

    const hover = async (name: string) => {
      await page.mouse.move(0, 0); // leave the previous bar so its tooltip closes
      await expect(page.locator('.gantt-tooltip')).toHaveCount(0);
      const label = (await page.locator('svg text', { hasText: name }).first().boundingBox())!;
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
    const linearFill = await page
      .locator('svg text', { hasText: 'Main epic' })
      .evaluate((label) => label.parentElement!.querySelector('rect.linear-progress')!.getAttribute('fill'));
    expect(linearFill).toBe('#ff3b30');

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
    expect(await barFill(page, '[Milestone] Empty sprint')).toBe('url(#nornir-closed-hatch)');
    await expect(row('[Milestone] Empty sprint')).toHaveAttribute('data-closed', 'true');
    await expect(row('[Milestone] Empty sprint')).not.toHaveAttribute('data-schedule', /.+/);
    expect(await nameColor('[Milestone] Empty sprint')).not.toBe(await nameColor('Main epic'));
    const hasLinear = await page
      .locator('svg text', { hasText: 'Empty sprint' })
      .evaluate((label) => !!label.parentElement!.querySelector('rect.linear-progress'));
    expect(hasLinear).toBe(false);

    // A closed issue is hatched too, an open one keeps its color.
    await page.getByTitle('Main epic').locator('..').getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
    expect(await barFill(page, 'Shared issue')).toBe('url(#nornir-closed-hatch)');
    expect(await barFill(page, 'Standalone issue')).not.toBe('url(#nornir-closed-hatch)');

    // The tooltip says it is closed, with its real progress.
    // Hover the start of the bar: its label (centered) may be beyond the visible area.
    const bar = (await page.locator('svg text', { hasText: 'Empty sprint' }).locator('xpath=..').locator('rect').first().boundingBox())!;
    await page.mouse.move(bar.x + 10, bar.y + bar.height / 2);
    const tooltip = page.locator('.gantt-tooltip');
    await expect(tooltip).toContainText('Closed');
    await expect(tooltip).toContainText('0% complete');
    await expect(tooltip).not.toContainText('Expected');
  });
});
