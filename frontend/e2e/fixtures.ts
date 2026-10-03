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

// Children planned past their parent's end. Under "Parent epic" (Oct 1 → 20): "Late issue"
// ends 5 days after it; the others are inside it, start before it, have a made-up due date
// or are closed, and aren't flagged. "Sprint issue" ends 2 days after its milestone.
// "Next year issue" ends 26 days after "Quarter parent", past the end of Q4 2026.
const day = (start: string, end: string) => ({ start, end, progress: 0, linearProgress: 0 });
export const overrunTree = [
  {
    id: 'M1', name: '[Milestone] Sprint 1', type: 'milestone', ...day('2026-10-01', '2026-10-16'),
    children: [{ id: 'I9_ms_I9', name: 'Sprint issue', type: 'issue', ...day('2026-10-08', '2026-10-18') }],
  },
  {
    id: 'E1', name: 'Parent epic', type: 'epic', ...day('2026-10-01', '2026-10-20'),
    children: [
      { id: 'I1', name: 'Late issue', type: 'issue', ...day('2026-10-10', '2026-10-25') },
      { id: 'I2', name: 'Inside issue', type: 'issue', ...day('2026-10-05', '2026-10-15') },
      { id: 'I3', name: 'Early issue', type: 'issue', ...day('2026-09-25', '2026-10-10') },
      { id: 'I4', name: 'No due issue', type: 'issue', noDueDate: true, ...day('2026-10-12', '2026-10-26') },
      { id: 'I5', name: 'Closed late issue', type: 'issue', closed: true, ...day('2026-10-10', '2026-10-28'), progress: 100 },
    ],
  },
  {
    id: 'E2', name: 'Quarter parent', type: 'epic', ...day('2026-10-01', '2026-12-20'),
    children: [{ id: 'I6', name: 'Next year issue', type: 'issue', ...day('2026-12-01', '2027-01-15') }],
  },
];

// Row warnings: "Empty epic" and "Empty sprint" have no child items in GitLab ("noChildren"
// from the backend); "Undated empty epic" also has no dates; "Finished epic" only has a closed
// issue, hidden by default, and isn't flagged; "Busy epic" has an open issue.
export const warningTree = [
  { id: 'M1', name: '[Milestone] Empty sprint', type: 'milestone', noChildren: true, start: '2026-10-01', end: '2026-10-31', progress: 0, linearProgress: 48 },
  { id: 'E1', name: 'Empty epic', type: 'epic', noChildren: true, start: '2026-10-01', end: '2026-10-31', progress: 0, linearProgress: 48 },
  {
    id: 'E2', name: 'Undated empty epic', type: 'epic', noChildren: true, noStartDate: true, noDueDate: true,
    start: '2026-10-15', end: '2026-10-16', progress: 0, linearProgress: 50,
  },
  {
    id: 'E3', name: 'Finished epic', type: 'epic', start: '2026-10-01', end: '2026-10-31', progress: 100, linearProgress: 48,
    children: [{ id: 'I1', name: 'Done issue', type: 'issue', closed: true, start: '2026-10-01', end: '2026-10-10', progress: 100, linearProgress: 100 }],
  },
  {
    id: 'E4', name: 'Busy epic', type: 'epic', health: 'atRisk', start: '2026-10-01', end: '2026-10-31', progress: 0, linearProgress: 48,
    children: [{ id: 'I2', name: 'Open issue', type: 'issue', start: '2026-10-01', end: '2026-10-10', progress: 0, linearProgress: 100 }],
  },
];

// Blocking links (tests run on 2026-10-15). Milestone 1.0 holds Auth API → Billing and
// Checkout, which is blocked by Shipping rules (milestone 2.0) and by Vendor SDK, outside the
// group; both end after Checkout starts. Standalone issue's only blocker is closed (hidden with
// the closed items). Epics under a milestone also have their `_root_` copy, as the backend
// sends them; every link is on both of its ends.
const dep = (id: string, name: string, start: string, end: string, fields: Record<string, unknown> = {}) => ({ id, name, start, end, ...fields });
const AUTH = dep('A', 'Auth API', '2026-10-01', '2026-10-10');
const BILLING = dep('B', 'Billing', '2026-10-12', '2026-10-20');
const CHECKOUT = dep('C', 'Checkout', '2026-10-05', '2026-10-30');
const SHIPPING = dep('X', 'Shipping rules', '2026-10-01', '2026-10-15');
const VENDOR = dep('V', 'Vendor SDK', '2026-10-01', '2026-10-08', { external: true, webUrl: 'https://gitlab.example.com/vendor/-/work_items/7' });
const depEpics = (suffix: (id: string) => string) => {
  const epic = (base: typeof AUTH, fields: Record<string, unknown>) => ({
    ...base, id: suffix(base.id), type: 'epic', progress: 0, linearProgress: 50, webUrl: undefined, ...fields,
  });
  return {
    auth: epic(AUTH, { blocking: [BILLING] }),
    billing: epic(BILLING, { blockedBy: [AUTH] }),
    checkout: epic(CHECKOUT, {
      blockedBy: [SHIPPING, VENDOR],
      children: [{ id: suffix('c1'), name: 'Cart page', type: 'issue', start: '2026-10-05', end: '2026-10-12', progress: 0, linearProgress: 100 }],
    }),
    shipping: epic(SHIPPING, { blocking: [CHECKOUT] }),
  };
};
const depCanonical = depEpics((id) => id);
const depRoot = (root: string) => depEpics((id) => `${id}_root_${root}`);
export const dependencyTree = [
  {
    id: 'M1', name: '[Milestone] 1.0', type: 'milestone', start: '2026-10-01', end: '2026-10-31', progress: 0, linearProgress: 48,
    children: [depCanonical.auth, depCanonical.billing, depCanonical.checkout],
  },
  {
    id: 'M2', name: '[Milestone] 2.0', type: 'milestone', start: '2026-10-01', end: '2026-10-31', progress: 0, linearProgress: 48,
    children: [depCanonical.shipping],
  },
  {
    id: 'I', name: 'Standalone issue', type: 'issue', start: '2026-10-01', end: '2026-10-20', progress: 0, linearProgress: 70,
    blockedBy: [dep('D', 'Done task', '2026-09-01', '2026-09-30', { closed: true })],
  },
  depRoot('A').auth,
  depRoot('B').billing,
  depRoot('C').checkout,
  depRoot('X').shipping,
];

// Dependencies inside a hierarchy, like a real milestone: Capability 2 › Feature 2 › US 1 and
// Feature 1 › US 6, US 7. Feature 2 blocks Feature 1, US 1 blocks US 6 and US 7, US 6 blocks US 7.
// Capability 2 has no link of its own: the dialog shows it for its place. Feature 4 (US 9 → US 10),
// in milestone 2, also blocks Feature 1, and US 10 blocks US 7. Critical path, on the user stories:
// US 9 → US 10 → US 6 (through Feature 4 → Feature 1) → US 7.
const NF2 = dep('F2', 'Feature 2', '2026-09-01', '2026-10-09');
const NF1 = dep('F1', 'Feature 1', '2026-10-05', '2026-10-30');
const NF4 = dep('F4', 'Feature 4', '2026-09-15', '2026-10-20');
const NUS9 = dep('U9', 'US 9', '2026-09-15', '2026-10-02');
const NUS10 = dep('U10', 'US 10', '2026-09-28', '2026-10-14');
const NUS1 = dep('U1', 'US 1', '2026-09-14', '2026-10-09');
const NUS6 = dep('U6', 'US 6', '2026-10-05', '2026-10-16');
const NUS7 = dep('U7', 'US 7', '2026-10-12', '2026-11-06');
const nested = (base: typeof NF2, type: string, fields: Record<string, unknown> = {}) => ({ ...base, type, progress: 0, linearProgress: 50, ...fields });
export const nestedDependencyTree = [
  {
    id: 'M1', name: '[Milestone] Milestone 1', type: 'milestone', start: '2026-09-01', end: '2026-10-31', progress: 0, linearProgress: 70,
    children: [
      nested(dep('CAP2', 'Capability 2', '2026-09-01', '2026-10-31'), 'epic', {
        children: [
          nested(NF2, 'epic', { blocking: [NF1], children: [nested(NUS1, 'issue', { blocking: [NUS7, NUS6] })] }),
          nested(NF1, 'epic', {
            blockedBy: [NF2, NF4],
            children: [
              nested(NUS7, 'issue', { blockedBy: [NUS1, NUS6, NUS10] }),
              nested(NUS6, 'issue', { blockedBy: [NUS1], blocking: [NUS7] }),
            ],
          }),
        ],
      }),
    ],
  },
  {
    id: 'M2', name: '[Milestone] Milestone 2', type: 'milestone', start: '2026-09-15', end: '2026-12-18', progress: 0, linearProgress: 20,
    children: [
      nested(dep('CAP1', 'Capability 1', '2026-09-15', '2026-12-18'), 'epic', {
        children: [
          nested(NF4, 'epic', {
            blocking: [NF1],
            children: [nested(NUS9, 'issue', { blocking: [NUS10] }), nested(NUS10, 'issue', { blockedBy: [NUS9], blocking: [NUS7] })],
          }),
        ],
      }),
    ],
  },
];

// Portfolios and shared links need real GitLab IDs (`gid://gitlab/…`): links carry them as
// "m1", "w10". Tests run on 2026-10-15. Release 1 holds Payments (its `_ms_` copy); Payments
// is late, and its Refunds ends past it; Search's Indexer is at risk; Billing has no children.
const W = (n: number) => `gid://gitlab/WorkItem/${n}`;
const MS = (n: number) => `gid://gitlab/Milestone/${n}`;
const payments = (suffix: string) => ({
  id: `${W(10)}${suffix}`, name: 'Payments', type: 'epic', start: '2026-09-01', end: '2026-10-31', progress: 0, linearProgress: 60,
  children: [{ id: `${W(11)}${suffix}`, name: 'Refunds', type: 'issue', start: '2026-10-01', end: '2026-11-15', progress: 0, linearProgress: 0 }],
});
export const portfolioTree = [
  {
    id: MS(1), name: '[Milestone] Release 1', type: 'milestone', start: '2026-09-01', end: '2026-11-30', progress: 50, linearProgress: 50,
    children: [payments(`_ms_${W(10)}`)],
  },
  {
    id: MS(2), name: '[Milestone] Release 2', type: 'milestone', start: '2026-12-01', end: '2026-12-31', progress: 0, linearProgress: 0,
    // An issue without a parent epic sits only under its milestone, without suffix.
    children: [{ id: W(30), name: 'Launch', type: 'issue', start: '2026-12-01', end: '2026-12-10', progress: 0, linearProgress: 0 }],
  },
  payments(''),
  {
    id: W(20), name: 'Search', type: 'epic', start: '2026-10-01', end: '2026-12-31', progress: 50, linearProgress: 20,
    children: [{ id: W(21), name: 'Indexer', type: 'issue', health: 'atRisk', start: '2026-10-01', end: '2026-10-20', progress: 0, linearProgress: 0 }],
  },
  { id: W(40), name: 'Billing', type: 'epic', noChildren: true, start: '2026-10-01', end: '2026-12-31', progress: 0, linearProgress: 20 },
];
