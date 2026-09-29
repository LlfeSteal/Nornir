import { Page } from '@playwright/test';

export const config = { group: 'demo/group', gitlabUrl: 'https://gitlab.example.com' };

// Representative tree, shaped like the backend output: a milestone holding the `_ms_` copy
// of an issue, an empty milestone, an epic holding the original issue and a nested epic,
// and the top-level `_root_` copy of that nested epic. The empty sprint and "Done issue"
// are closed (hidden unless the Closed button is on). Labels: backend, frontend, team-a are
// group labels; bug is a project label (only found on an item); security is unused.
const backend = { title: 'backend', color: '#428bca' };
const frontend = { title: 'frontend', color: '#69d100' };
const teamA = { title: 'team-a', color: '#f0ad4e' };
const bug = { title: 'bug', color: '#d9534f' };

/** Labels of the group, as returned by /api/labels (sorted by title). */
export const groupLabels = [backend, frontend, { title: 'security', color: '#330066' }, teamA];

export const tree = [
  {
    id: 'M1', name: '[Milestone] Sprint 1', type: 'milestone', start: '2026-10-01', end: '2026-10-31',
    progress: 50, linearProgress: 20, // ahead of schedule webUrl: 'https://gitlab.example.com/m1',
    children: [
      { id: 'I1_ms_I1', name: 'Shared issue', type: 'issue', labels: [backend], start: '2026-10-02', end: '2026-10-10', progress: 100, linearProgress: 0, webUrl: 'https://gitlab.example.com/i1' },
    ],
  },
  { id: 'M2', name: '[Milestone] Empty sprint', type: 'milestone', closed: true, start: '2026-11-01', end: '2026-11-30', progress: 0, linearProgress: 0 },
  {
    id: 'E1', name: 'Main epic', type: 'epic', labels: [teamA], start: '2026-10-01', end: '2026-12-01', progress: 50, linearProgress: 80, // behind schedule
    children: [
      { id: 'I1', name: 'Shared issue', type: 'issue', labels: [backend], start: '2026-10-02', end: '2026-10-10', progress: 100, linearProgress: 0 },
      { id: 'I2', name: 'Standalone issue', type: 'issue', labels: [frontend], start: '2026-10-15', end: '2026-10-25', progress: 0, linearProgress: 0 },
      { id: 'I4', name: 'Done issue', type: 'issue', labels: [backend], closed: true, start: '2026-10-02', end: '2026-10-08', progress: 100, linearProgress: 0 },
      {
        id: 'E2', name: 'Child epic', type: 'epic', labels: [backend], start: '2026-11-01', end: '2026-11-20', progress: 0, linearProgress: 3, // slightly behind
        children: [{ id: 'I3', name: 'Deep issue', type: 'issue', labels: [frontend, bug], start: '2026-11-02', end: '2026-11-10', progress: 0, linearProgress: 0 }],
      },
    ],
  },
  {
    id: 'E2_root_E2', name: 'Child epic', type: 'epic', labels: [backend], start: '2026-11-01', end: '2026-11-20', progress: 0, linearProgress: 3,
    children: [{ id: 'I3_root_E2', name: 'Deep issue', type: 'issue', labels: [frontend, bug], start: '2026-11-02', end: '2026-11-10', progress: 0, linearProgress: 0 }],
  },
];

/** Replaces the backend with fixed responses; returns the /api/gantt URLs that were called. */
export async function mockApi(
  page: Page,
  gantt: { status?: number; body: unknown; delayMs?: number } = { body: tree },
  labels: { status?: number; body: unknown } = { body: groupLabels },
) {
  const ganttCalls: string[] = [];
  await page.route('**/api/config', (route) => route.fulfill({ json: config }));
  await page.route('**/api/labels*', (route) => route.fulfill({ status: labels.status ?? 200, json: labels.body }));
  await page.route('**/api/gantt*', async (route) => {
    ganttCalls.push(route.request().url());
    if (gantt.delayMs) await new Promise((resolve) => setTimeout(resolve, gantt.delayMs));
    return route.fulfill({ status: gantt.status ?? 200, json: gantt.body });
  });
  return ganttCalls;
}

// Items spread over several years, for the period selector (tests run on 2026-10-15). The
// long epic crosses into 2027 and its only issue is in 2027; the current epic has an issue
// left over in 2025.
export const periodTree = [
  { id: 'M9', name: '[Milestone] Q4 sprint', type: 'milestone', start: '2026-10-01', end: '2026-12-31', progress: 0, linearProgress: 15 },
  {
    id: 'E9', name: 'Old epic', type: 'epic', start: '2025-02-01', end: '2025-06-30', progress: 100, linearProgress: 100,
    children: [{ id: 'I9', name: 'Old issue', type: 'issue', start: '2025-03-01', end: '2025-03-20', progress: 100, linearProgress: 100 }],
  },
  {
    id: 'E10', name: 'Current epic', type: 'epic', start: '2026-09-01', end: '2026-11-30', progress: 50, linearProgress: 50,
    children: [
      { id: 'I10', name: 'Current issue', type: 'issue', start: '2026-10-01', end: '2026-10-20', progress: 0, linearProgress: 70 },
      { id: 'I11', name: 'Stale issue', type: 'issue', start: '2025-05-01', end: '2025-05-15', progress: 0, linearProgress: 100 },
    ],
  },
  {
    id: 'E11', name: 'Long epic', type: 'epic', start: '2026-06-01', end: '2027-03-31', progress: 40, linearProgress: 45,
    children: [{ id: 'I12', name: 'Next year issue', type: 'issue', start: '2027-02-01', end: '2027-02-20', progress: 0, linearProgress: 0 }],
  },
  { id: 'E12', name: 'Future epic', type: 'epic', start: '2027-05-01', end: '2027-08-31', progress: 0, linearProgress: 0 },
];

// GitLab health status, shaped like the backend output: "Webhooks" needs attention (under
// Sprint 1 as a `_ms_` copy and under Payments), "Refund API" is at risk, "Old risk" is at
// risk but closed (not counted). Payments is itself on track; Onboarding has nothing.
export const healthTree = [
  {
    id: 'M1', name: '[Milestone] Sprint 1', type: 'milestone', start: '2026-10-01', end: '2026-10-31', progress: 0, linearProgress: 45,
    healthBelow: { atRisk: 0, needsAttention: 1 },
    children: [
      { id: 'I1_ms_I1', name: 'Webhooks', type: 'issue', health: 'needsAttention', start: '2026-10-05', end: '2026-10-20', progress: 0, linearProgress: 60 },
    ],
  },
  {
    id: 'E1', name: 'Payments', type: 'epic', health: 'onTrack', start: '2026-10-01', end: '2026-11-30', progress: 30, linearProgress: 20,
    healthBelow: { atRisk: 1, needsAttention: 1 },
    children: [
      { id: 'I1', name: 'Webhooks', type: 'issue', health: 'needsAttention', start: '2026-10-05', end: '2026-10-20', progress: 0, linearProgress: 60 },
      { id: 'I2', name: 'Refund API', type: 'issue', health: 'atRisk', start: '2026-10-10', end: '2026-11-10', progress: 0, linearProgress: 15 },
      { id: 'I3', name: 'Old risk', type: 'issue', health: 'atRisk', closed: true, start: '2026-10-01', end: '2026-10-05', progress: 100, linearProgress: 100 },
    ],
  },
  {
    id: 'E3', name: 'Onboarding', type: 'epic', start: '2026-10-01', end: '2026-12-31', progress: 0, linearProgress: 15,
    children: [{ id: 'I5', name: 'Logs', type: 'issue', start: '2026-10-01', end: '2026-10-31', progress: 0, linearProgress: 45 }],
  },
];
