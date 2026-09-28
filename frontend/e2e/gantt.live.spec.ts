import { expect, test } from '@playwright/test';

// End-to-end test against the real backend (and so the real GitLab configured in .env).
// It assumes nothing about the group's content, only that loading succeeds.
test.describe('Gantt (real backend) @live', () => {
  test('loads the configured group Gantt without error', async ({ page, request }) => {
    const configResponse = await request.get('/api/config');
    expect(configResponse.ok()).toBeTruthy();
    const { group } = await configResponse.json();

    const ganttResponse = page.waitForResponse((r) => r.url().includes('/api/gantt'));
    await page.goto('/');
    expect((await ganttResponse).status()).toBe(200);

    await expect(page.getByRole('link', { name: group })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.gantt-chart')).toBeVisible();
  });

  test("lists the group's labels and shows the filter bar", async ({ page, request }) => {
    const labelsResponse = await request.get('/api/labels');
    expect(labelsResponse.ok()).toBeTruthy();
    const labels = await labelsResponse.json();
    expect(Array.isArray(labels)).toBe(true);
    for (const label of labels) expect(label).toEqual({ title: expect.any(String), color: expect.any(String) });

    await page.goto('/');
    await expect(page.getByRole('search', { name: 'Filters' })).toBeVisible();
    await page.getByRole('button', { name: 'Labels' }).click();
    await expect(page.getByRole('dialog', { name: 'Labels' })).toBeVisible();
  });
});
