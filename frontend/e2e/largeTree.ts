// A production-sized group, shaped like the backend output (see tree_builder.go): 30
// milestones, 40 top-level epics each holding 5 epics each holding 3 epics (840 epics), and
// 4,000 issues spread over the deepest epics, half of them also in a milestone. As in the
// backend, an issue both under an epic and in a milestone gets a `_ms_` copy under the
// milestone, and every nested epic gets a `_root_` copy at the top level with its subtree:
// about 16,000 rows in all. Deterministic, dates around October 2026.

interface Row {
  id: string;
  name: string;
  type: 'milestone' | 'epic' | 'issue';
  start: string;
  end: string;
  progress: number;
  linearProgress: number;
  webUrl?: string;
  closed?: boolean;
  labels?: { title: string; color: string }[];
  children?: Row[];
}

export const LARGE = { milestones: 30, topEpics: 40, childEpics: 5, grandchildEpics: 3, issues: 4000 };

const LABELS = ['backend', 'frontend', 'team-a', 'team-b', 'bug', 'feature'].map((title, i) => ({
  title,
  color: ['#428bca', '#69d100', '#f0ad4e', '#5843ad', '#d9534f', '#330066'][i],
}));

function day(offset: number): string {
  const date = new Date(2026, 0, 1 + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function withSuffix(row: Row, suffix: string): Row {
  return { ...row, id: row.id + suffix, children: row.children?.map((child) => withSuffix(child, suffix)) };
}

export function largeTree(): Row[] {
  const milestones: Row[] = Array.from({ length: LARGE.milestones }, (_, m) => ({
    id: `M${m}`,
    name: `[Milestone] Sprint ${m}`,
    type: 'milestone',
    start: day(14 * m),
    end: day(14 * m + 13),
    progress: 40,
    linearProgress: 50,
    children: [],
  }));

  const deepest: Row[] = [];
  const nested: Row[] = []; // epics that have a parent: they also get a top-level copy
  const epic = (id: string, name: string, offset: number, length: number): Row => ({
    id, name, type: 'epic', start: day(offset), end: day(offset + length), progress: 30, linearProgress: 45,
    labels: [LABELS[id.length % LABELS.length]], webUrl: `https://gitlab.example.com/epics/${id}`, children: [],
  });
  const roots: Row[] = Array.from({ length: LARGE.topEpics }, (_, a) => {
    const top = epic(`E${a}`, `Epic ${a}`, 9 * a, 120);
    for (let b = 0; b < LARGE.childEpics; b++) {
      const child = epic(`E${a}-${b}`, `Epic ${a}.${b}`, 9 * a + 10 * b, 60);
      nested.push(child);
      top.children!.push(child);
      for (let c = 0; c < LARGE.grandchildEpics; c++) {
        const grandchild = epic(`E${a}-${b}-${c}`, `Epic ${a}.${b}.${c}`, 9 * a + 10 * b + 7 * c, 30);
        nested.push(grandchild);
        deepest.push(grandchild);
        child.children!.push(grandchild);
      }
    }
    return top;
  });

  for (let i = 0; i < LARGE.issues; i++) {
    const parent = deepest[i % deepest.length];
    const offset = 5 * (i % 70);
    const issue: Row = {
      id: `I${i}`, name: `Issue ${i}`, type: 'issue', start: day(offset), end: day(offset + 8),
      progress: i % 3 === 0 ? 100 : 0, linearProgress: 0, closed: i % 3 === 0, labels: [LABELS[i % LABELS.length]],
      webUrl: `https://gitlab.example.com/issues/${i}`,
    };
    parent.children!.push(issue);
    if (i % 2 === 0) milestones[i % LARGE.milestones].children!.push(withSuffix(issue, `_ms_I${i}`));
  }

  // Nested epics listed at the top level too, depth-first, with their whole subtree.
  const copies = nested.map((row) => withSuffix(row, `_root_${row.id}`));
  return [...milestones, ...roots, ...copies];
}

/** Number of rows in the tree, copies included. */
export function countRows(rows: Row[]): number {
  return rows.reduce((sum, row) => sum + 1 + countRows(row.children ?? []), 0);
}

// Another shape, harder on the list: 5,200 top-level epics, epic i holding 2 + (i % 4) issues
// ("Task <i>.<j>", 2 to 5 each, ~18,000 in all, one in five closed). No milestone and no copy:
// every epic is a root, which is what the backend produces for such a group.
export const MANY_EPICS = { epics: 5_200 };

/** Whether the j-th issue of epic i is closed (one in five). */
export const isClosedTask = (i: number, j: number) => (i + j) % 5 === 0;

export function manyEpicsTree(): Row[] {
  return Array.from({ length: MANY_EPICS.epics }, (_, i) => {
    const offset = (7 * i) % 330;
    const children: Row[] = Array.from({ length: 2 + (i % 4) }, (_, j) => ({
      id: `T${i}-${j}`, name: `Task ${i}.${j}`, type: 'issue', start: day(offset + 3 * j), end: day(offset + 3 * j + 6),
      progress: isClosedTask(i, j) ? 100 : 0, linearProgress: 0, closed: isClosedTask(i, j),
      labels: [LABELS[(i + j) % LABELS.length]], webUrl: `https://gitlab.example.com/issues/${i}-${j}`,
    }));
    const done = children.filter((child) => child.closed).length;
    return {
      id: `E${i}`, name: `Epic ${i}`, type: 'epic', start: day(offset), end: day(offset + 30),
      progress: (100 * done) / children.length, linearProgress: 50, labels: [LABELS[i % LABELS.length]],
      webUrl: `https://gitlab.example.com/epics/${i}`, children,
    };
  });
}

// The worst case: a deep hierarchy full of copies. 5 levels of epics (20 → ×4 → ×4 → ×3 → ×3,
// 4,260 epics), 3 issues under each deepest epic (8,640, one in five closed), and 40
// milestones holding half of the top-level epics, every second-level epic (each with its
// whole subtree) and half of the issues. Built with the rules of the backend's
// tree_builder.go (copies `_ms_` / `_root_` with their subtree, same order): same shape, IDs
// and order as deepGroup() in tree_builder_deep_test.go, checked by DEEP.sha256.
export const DEEP = {
  levels: [20, 4, 4, 3, 3],
  milestones: 40,
  issuesPerEpic: 3,
  rows: 86_270,
  maxDepth: 6, // milestone → 5 levels of epics → issue
  sha256: '939b761522c88bbe9faa5b9866a8de4e22c3a34a47cc1b65b509ae3eed273df5',
};

interface Item {
  id: string;
  name: string;
  type: 'epic' | 'issue';
  start: string;
  end: string;
  closed: boolean;
  labels: { title: string; color: string }[];
  parent?: string;
  milestone?: number;
}

const lastSegment = (id: string) => id.slice(id.lastIndexOf('/') + 1);

/** The work items, in the order the API returns them (depth-first, like deepGroup()). */
function deepItems(): Item[] {
  const items: Item[] = [];
  let issues = 0;
  const visit = (path: number[], parent?: string) => {
    const level = path.length;
    const key = path.join('-');
    const id = `gid://gitlab/WorkItem/e${key}`;
    const n = items.length;
    const offset = path[0] * 9 + level * 5;
    // Milestones hold half of the top-level epics and every second-level epic.
    const inMilestone = (level === 1 && path[0] % 2 === 1) || level === 2;
    items.push({
      id, name: `Epic ${path.join('.')}`, type: 'epic', start: day(offset), end: day(offset + Math.floor(120 / level)),
      closed: false, labels: [LABELS[n % LABELS.length]], parent,
      milestone: inMilestone ? (path[0] * 4 + path[level - 1]) % DEEP.milestones : undefined,
    });
    if (level === DEEP.levels.length) {
      for (let k = 0; k < DEEP.issuesPerEpic; k++) {
        const i = issues++;
        items.push({
          id: `gid://gitlab/WorkItem/i${key}-${k}`, name: `Issue ${path.join('.')}.${k}`, type: 'issue',
          start: day(i % 300), end: day((i % 300) + 7), closed: i % 5 === 0, labels: [LABELS[i % LABELS.length]],
          parent: id, milestone: i % 2 === 0 ? i % DEEP.milestones : undefined,
        });
      }
      return;
    }
    for (let c = 0; c < DEEP.levels[level]; c++) visit([...path, c], id);
  };
  for (let a = 0; a < DEEP.levels[0]; a++) visit([a]);
  return items;
}

export function deepTree(): Row[] {
  const items = deepItems();
  const byId = new Map(items.map((item) => [item.id, item]));
  const children = new Map<string, string[]>();
  const milestoneChildren = new Map<number, string[]>();
  const roots: string[] = [];
  for (const item of items) {
    if (item.parent) children.set(item.parent, [...(children.get(item.parent) ?? []), item.id]);
    if (item.milestone !== undefined) milestoneChildren.set(item.milestone, [...(milestoneChildren.get(item.milestone) ?? []), item.id]);
    if (!item.parent && item.milestone === undefined) roots.push(item.id);
  }
  const mean = (rows: Row[]) => rows.reduce((sum, row) => sum + row.progress, 0) / rows.length;

  // An item with its whole subtree, every ID followed by the suffix of the copy.
  const materialize = (id: string, suffix: string): Row => {
    const item = byId.get(id)!;
    const kids = (children.get(id) ?? []).map((child) => materialize(child, suffix));
    return {
      id: id + suffix, name: item.name, type: item.type, start: item.start, end: item.end,
      progress: kids.length ? mean(kids) : item.closed ? 100 : 0, linearProgress: 50,
      closed: item.closed || undefined, labels: item.labels, webUrl: `https://gitlab.example.com/${lastSegment(id)}`,
      children: kids.length ? kids : undefined,
    };
  };

  // Milestones first (by start date), holding their items: a copy `_ms_` for those that also
  // sit under a parent. Then the roots, then a top-level copy of every other epic.
  const result: Row[] = [];
  const canonical: string[] = [];
  for (let m = 0; m < DEEP.milestones; m++) {
    const kids = (milestoneChildren.get(m) ?? []).map((id) => {
      if (!byId.get(id)!.parent) canonical.push(id);
      return materialize(id, byId.get(id)!.parent ? `_ms_${lastSegment(id)}` : '');
    });
    result.push({
      id: `gid://gitlab/Milestone/${m}`, name: `[Milestone] Sprint ${String(m).padStart(2, '0')}`, type: 'milestone',
      start: day(14 * m), end: day(14 * m + 13), progress: kids.length ? mean(kids) : 0, linearProgress: 50,
      children: kids.length ? kids : undefined,
    });
  }
  const isRoot = new Set(roots);
  for (const id of roots) {
    canonical.push(id);
    result.push(materialize(id, ''));
  }
  const seen = new Set<string>();
  const collectEpics = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (byId.get(id)!.type === 'epic' && !isRoot.has(id)) result.push(materialize(id, `_root_${lastSegment(id)}`));
    (children.get(id) ?? []).forEach(collectEpics);
  };
  canonical.forEach(collectEpics);
  return result;
}
