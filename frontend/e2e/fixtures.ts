import { Page } from '@playwright/test';

export const config = { group: 'demo/group', gitlabUrl: 'https://gitlab.example.com' };

// Representative tree: a milestone holding the `_ms` copy of an issue,
// an epic holding the original, and an empty milestone.
export const tree = [
  {
    id: 'M1', name: '[Milestone] Sprint 1', type: 'milestone', start: '2026-10-01', end: '2026-10-31',
    progress: 50, webUrl: 'https://gitlab.example.com/m1',
    children: [
      { id: 'I1_ms', name: 'Shared issue', type: 'issue', start: '2026-10-02', end: '2026-10-10', progress: 100, webUrl: 'https://gitlab.example.com/i1' },
    ],
  },
  { id: 'M2', name: '[Milestone] Empty sprint', type: 'milestone', start: '2026-11-01', end: '2026-11-30', progress: 0 },
  {
    id: 'E1', name: 'Main epic', type: 'epic', start: '2026-10-01', end: '2026-12-01', progress: 50,
    children: [
      { id: 'I1', name: 'Shared issue', type: 'issue', start: '2026-10-02', end: '2026-10-10', progress: 100 },
      { id: 'I2', name: 'Standalone issue', type: 'issue', start: '2026-10-15', end: '2026-10-25', progress: 0 },
    ],
  },
];

/** Replaces the backend with fixed responses; returns the /api/gantt URLs that were called. */
export async function mockApi(page: Page, gantt: { status?: number; body: unknown } = { body: tree }) {
  const ganttCalls: string[] = [];
  await page.route('**/api/config', (route) => route.fulfill({ json: config }));
  await page.route('**/api/gantt*', (route) => {
    ganttCalls.push(route.request().url());
    return route.fulfill({ status: gantt.status ?? 200, json: gantt.body });
  });
  return ganttCalls;
}
