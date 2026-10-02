import { DependencyRef, GanttTask } from '../types/gantt';
import { canonicalId, TOP_COPY_SUFFIX } from './filters';
import { Row, visibleRows } from './flatten';
import { parseDay } from './timeline';

// GitLab "blocked by" / "blocks" links. In the chart: a mark on blocked rows and a red hatch on
// the part of a bar planned before its blocker ends. A row whose subtree holds links opens them in a
// dialog: a chart of the items involved under their parents, with arrows from each blocker to what
// it blocks and the critical path brought forward.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The GitLab ID of a row: without the suffix of its copy, including the filters' `_top`. */
export function gitlabId(id: string): string {
  return canonicalId(id.endsWith(TOP_COPY_SUFFIX) ? id.slice(0, -TOP_COPY_SUFFIX.length) : id);
}

/** The blockers that still block: the open ones. */
export function openBlockers(node: GanttTask): DependencyRef[] {
  return node.blockedBy?.filter((ref) => !ref.closed) ?? [];
}

/** Lists names: "A, B and 2 more". */
function names(refs: DependencyRef[], max = 3): string {
  const shown = refs.slice(0, max).map((ref) => ref.name);
  return refs.length > max ? `${shown.join(', ')} and ${refs.length - max} more` : shown.join(', ');
}

/** "Blocked by A, B", for the open blockers; undefined when none. */
export function blockedMessage(node: GanttTask): string | undefined {
  const open = openBlockers(node);
  return open.length > 0 ? `Blocked by ${names(open)}` : undefined;
}

export interface BlockerConflict {
  blocker: DependencyRef;
  days: number; // how long before the blocker's end the row starts
}

/** Whether `blocked` is planned to start before `blocker` ends; undefined when it isn't, when
 * either is closed, or when a date in play is made up (missing in GitLab). */
function conflictBetween(
  blocker: Pick<DependencyRef, 'end' | 'closed' | 'noDueDate'>,
  blocked: Pick<GanttTask, 'start' | 'closed' | 'noStartDate'>,
): number | undefined {
  if (blocker.closed || blocked.closed || blocker.noDueDate || blocked.noStartDate) return undefined;
  const end = parseDay(blocker.end);
  const start = parseDay(blocked.start);
  if (start >= end) return undefined;
  // Rounded: a day across a daylight saving change is 23 or 25 hours long.
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

/** The open blockers that end after the row starts. */
export function blockerConflicts(
  node: Partial<Pick<GanttTask, 'start' | 'closed' | 'noStartDate' | 'blockedBy'>>,
): BlockerConflict[] {
  const conflicts: BlockerConflict[] = [];
  const { start } = node;
  if (!start) return conflicts;
  for (const blocker of node.blockedBy ?? []) {
    const days = conflictBetween(blocker, { ...node, start });
    if (days !== undefined) conflicts.push({ blocker, days });
  }
  return conflicts;
}

/** "Starts 3 days before Payments ends". */
export function conflictMessage(conflict: BlockerConflict): string {
  return `Starts ${conflict.days} ${conflict.days === 1 ? 'day' : 'days'} before ${conflict.blocker.name} ends`;
}

/** The part of a row planned before its open blockers end, hatched in red: from its start to
 * the latest end among them, at most its own end. Undefined when there is no conflict. */
export function blockedSpan(
  node: Pick<GanttTask, 'start' | 'end'> & Partial<Pick<GanttTask, 'closed' | 'noStartDate' | 'blockedBy'>>,
): { from: Date; to: Date } | undefined {
  const conflicts = blockerConflicts(node);
  if (conflicts.length === 0) return undefined;
  const latest = Math.max(...conflicts.map((conflict) => parseDay(conflict.blocker.end).getTime()));
  return { from: parseDay(node.start), to: new Date(Math.min(parseDay(node.end).getTime(), latest)) };
}

interface Edge {
  blocker: string; // GitLab IDs
  blocked: string;
}

/** Every link of a tree, found once. */
export interface DependencyIndex {
  edges: Edge[];
  /** Item by GitLab ID (its first row), for the items in the tree. */
  nodes: Map<string, GanttTask>;
  /** Where an item sits: "Milestone 1.0 › Epic A" (its first row's ancestors). */
  paths: Map<string, string>;
  /** Items outside the group, by GitLab ID. */
  externals: Map<string, DependencyRef>;
  /** Edges by GitLab ID of either end. */
  byItem: Map<string, Edge[]>;
  /** The parent work item of each item (GitLab IDs; its first placement under a work item, not
   * under a milestone). */
  parents: Map<string, string>;
  counts: WeakMap<GanttTask, number>;
}

/** Indexes the links of a tree (closed items hidden or not, as shown). A link counts when both
 * ends are shown: an item of the tree, or an item outside the group (closed ones only with
 * `includeClosed`). */
export function dependencyIndex(tree: GanttTask[], includeClosed: boolean): DependencyIndex {
  const nodes = new Map<string, GanttTask>();
  const paths = new Map<string, string>();
  const parents = new Map<string, string>();
  const visit = (list: GanttTask[], path: string, parent?: GanttTask) =>
    list.forEach((node) => {
      const id = gitlabId(node.id);
      if (!nodes.has(id)) {
        nodes.set(id, node);
        paths.set(id, path);
      }
      if (parent && parent.type !== 'milestone' && !parents.has(id)) parents.set(id, gitlabId(parent.id));
      if (node.children) visit(node.children, path ? `${path} › ${node.name}` : node.name, node);
    });
  visit(tree, '');

  const externals = new Map<string, DependencyRef>();
  const edges: Edge[] = [];
  const byItem = new Map<string, Edge[]>();
  const seen = new Set<string>();
  const shown = (ref: DependencyRef) => {
    if (nodes.has(ref.id)) return true;
    if (!ref.external || (ref.closed && !includeClosed)) return false;
    if (!externals.has(ref.id)) externals.set(ref.id, ref);
    return true;
  };
  const add = (blocker: string, blocked: string) => {
    const key = `${blocker} ${blocked}`;
    if (blocker === blocked || seen.has(key)) return;
    seen.add(key);
    const edge = { blocker, blocked };
    edges.push(edge);
    for (const id of [blocker, blocked]) byItem.set(id, [...(byItem.get(id) ?? []), edge]);
  };
  for (const [id, node] of nodes) {
    node.blockedBy?.forEach((ref) => shown(ref) && add(ref.id, id));
    node.blocking?.forEach((ref) => shown(ref) && add(id, ref.id));
  }
  return { edges, nodes, paths, externals, byItem, parents, counts: new WeakMap() };
}

/** The GitLab IDs of a row and its descendants. */
function subtreeIds(node: GanttTask, out = new Set<string>()): Set<string> {
  out.add(gitlabId(node.id));
  node.children?.forEach((child) => subtreeIds(child, out));
  return out;
}

/** The item of the index behind a row (the row may be cut by the period or the filters). */
function fullNode(index: DependencyIndex, node: GanttTask): GanttTask {
  return index.nodes.get(gitlabId(node.id)) ?? node;
}

/** The links needed to finish an item: those blocking it or its descendants, then those blocking
 * its blockers (with their descendants), and so on — not what it unblocks. `ids`: the item's
 * subtree. */
function requiredEdges(index: DependencyIndex, node: GanttTask): { ids: Set<string>; edges: Edge[] } {
  const ids = subtreeIds(node);
  const needed = new Set<string>([gitlabId(node.id)]);
  const edges = new Set<Edge>();
  // Breadth first, without recursion: blocking chains can be long.
  const queue = [node];
  const need = (task: GanttTask) => {
    const id = gitlabId(task.id);
    if (needed.has(id)) return;
    needed.add(id);
    queue.push(task);
  };
  for (let i = 0; i < queue.length; i++) {
    const task = queue[i];
    const id = gitlabId(task.id);
    for (const edge of index.byItem.get(id) ?? []) {
      if (edge.blocked !== id) continue;
      edges.add(edge);
      const blocker = index.nodes.get(edge.blocker);
      if (blocker) need(blocker);
      else needed.add(edge.blocker); // outside the group
    }
    task.children?.forEach(need);
  }
  return { ids, edges: [...edges] };
}

/** How many links are needed to finish a row's item (whatever the filters hide). */
export function dependencyCount(index: DependencyIndex, node: GanttTask): number {
  if (index.edges.length === 0) return 0;
  const full = fullNode(index, node);
  let count = index.counts.get(full);
  if (count === undefined) {
    count = requiredEdges(index, full).edges.length;
    index.counts.set(full, count);
  }
  return count;
}

/** A row of the dependencies dialog: an item of the row's subtree, or a blocker it needs found
 * elsewhere in the group (`path`) or outside it (`external`). */
export interface DependencyRowInfo {
  linked: boolean;
  external: boolean;
  path?: string;
  critical?: boolean; // on the critical path
  criticalVia?: string; // how the critical path reaches it through epics: "after US 10 (through F4 → F1)"
  context?: boolean; // a parent shown for its place, without a link of its own
}

export interface DependencyLink {
  from: string; // row IDs (GitLab IDs)
  to: string;
  conflict: boolean;
  critical?: boolean; // between two items of the critical path
  derived?: boolean; // a step of the critical path through epics, without a GitLab link of its own
}

export interface DependencySubgraph {
  rows: Row[];
  links: DependencyLink[];
  /** How many items the critical path holds, 0 without one. */
  critical: number;
}

/** A step of the critical path: `from` holds `to` up through the GitLab link `edge`, between
 * them (`direct`) or between epics holding them. */
export interface CriticalStep {
  from: string;
  to: string;
  edge: Edge;
  direct: boolean;
}

/** The critical path of an item, on the real work: its leaves (items without children: user
 * stories, or epics without any). It ends at the open leaf of the item that ends latest (ties:
 * the longer chain, then the earliest start, then the ID), blocked or not, and walks back through
 * each leaf's driving blocker: among the links into the leaf **or into one of its ancestors** (a
 * blocked epic holds up its user stories), the blocker's leaf that ends latest (a blocking epic is
 * done when its user stories are; an item outside the group counts as itself); the leaf's own
 * links win ties. Closed leaves and made-up due dates don't count. GitLab IDs, first leaf first,
 * and the steps between them; empty when the item has no open leaf. */
export function criticalPath(index: DependencyIndex, root: GanttTask): { ids: string[]; steps: CriticalStep[] } {
  const counts = (task: GanttTask) => !task.closed && !task.noDueDate;
  const leaves = new Map<string, GanttTask[]>();
  const leavesOf = (id: string): GanttTask[] => {
    let found = leaves.get(id);
    if (found) return found;
    const node = index.nodes.get(id);
    if (node) {
      const byId = new Map<string, GanttTask>();
      const visit = (task: GanttTask) => {
        if (task.children?.length) task.children.forEach(visit);
        else if (task.type !== 'milestone' && counts(task)) byId.set(gitlabId(task.id), { ...task, id: gitlabId(task.id), children: undefined });
      };
      visit(node);
      found = [...byId.values()];
    } else {
      const ref = index.externals.get(id);
      found = ref && !ref.closed && !ref.noDueDate ? [externalTask(ref)] : [];
    }
    leaves.set(id, found);
    return found;
  };

  const drivers = new Map<string, { leaf: GanttTask; edge: Edge } | undefined>();
  const driver = (leaf: GanttTask) => {
    if (drivers.has(leaf.id)) return drivers.get(leaf.id);
    let best: { leaf: GanttTask; edge: Edge } | undefined;
    const seen = new Set<string>();
    for (let at: string | undefined = leaf.id; at !== undefined && !seen.has(at); at = index.parents.get(at)) {
      seen.add(at);
      for (const edge of index.byItem.get(at) ?? []) {
        if (edge.blocked !== at) continue;
        for (const candidate of leavesOf(edge.blocker)) {
          if (candidate.id !== leaf.id && (!best || candidate.end > best.leaf.end)) best = { leaf: candidate, edge };
        }
      }
    }
    drivers.set(leaf.id, best);
    return best;
  };
  const walk = (end: GanttTask) => {
    const ids = [end.id];
    const steps: CriticalStep[] = [];
    const seen = new Set(ids);
    for (let leaf = end, step = driver(end); step && !seen.has(step.leaf.id); leaf = step.leaf, step = driver(leaf)) {
      const direct = step.edge.blocker === step.leaf.id && step.edge.blocked === leaf.id;
      steps.unshift({ from: step.leaf.id, to: leaf.id, edge: step.edge, direct });
      ids.unshift(step.leaf.id);
      seen.add(step.leaf.id);
    }
    return { ids, steps };
  };

  const ends = leavesOf(gitlabId(root.id));
  const latest = ends.reduce((end, task) => (task.end > end ? task.end : end), '');
  let best: { ids: string[]; steps: CriticalStep[]; start: string } = { ids: [], steps: [], start: '' };
  for (const end of ends.filter((task) => task.end === latest).sort((a, b) => a.id.localeCompare(b.id))) {
    const path = walk(end);
    const start = (index.nodes.get(path.ids[0]) ?? leavesOf(path.ids[0])[0] ?? end).start;
    if (path.ids.length > best.ids.length || (path.ids.length === best.ids.length && start < best.start)) best = { ...path, start };
  }
  return { ids: best.ids, steps: best.steps };
}

export const ARROW_GAP = 10; // px, horizontal run out of a bar and into the next
const ARROW_LANE = 4; // px, from the row's edge: where an arrow going round runs, off the bars

/** The SVG path of an arrow from a blocker's end (x1, y1) to the start of what it blocks (x2, y2),
 * the middles of their rows. With room between the bars: out, down (or up), in. Otherwise it goes
 * round: down (or up) at the blocker's end to a lane inside the target's row, off its bar — under
 * its top coming from above, over its bottom coming from below — then back to the target's
 * start. Each arrow runs along its own target's row: two targets starting together share
 * nothing. */
export function arrowPath(x1: number, y1: number, x2: number, y2: number, rowHeight: number): string {
  if (x2 - x1 >= 2 * ARROW_GAP) return `M${x1},${y1} H${x1 + ARROW_GAP} V${y2} H${x2}`;
  const lane = y2 + (y2 > y1 ? -1 : 1) * (rowHeight / 2 - ARROW_LANE);
  return `M${x1},${y1} h${ARROW_GAP} V${lane} H${x2 - ARROW_GAP} V${y2} H${x2}`;
}

function externalTask(ref: DependencyRef): GanttTask {
  return {
    id: ref.id,
    name: ref.name,
    type: 'issue',
    start: ref.start,
    end: ref.end,
    progress: ref.closed ? 100 : 0,
    linearProgress: 0,
    webUrl: ref.webUrl,
    closed: ref.closed,
    noStartDate: ref.noStartDate,
    noDueDate: ref.noDueDate,
  };
}

/** What must be done to finish a row: the items of its subtree blocked by something, their
 * blockers, the blockers' own (with their descendants'), and so on — not what the row unblocks.
 * The items with a link, those of the subtree under their parents (`context` rows for the parents
 * without a link, the row itself left out), those from elsewhere at the top level. Fully
 * expanded, siblings in dependency order (a blocker before what it blocks; by start date
 * otherwise, and in a cycle). */
export function dependencySubgraph(index: DependencyIndex, node: GanttTask): DependencySubgraph {
  const full = fullNode(index, node);
  const { ids, edges } = requiredEdges(index, full);
  if (edges.length === 0) return { rows: [], links: [], critical: 0 };

  const tasks = new Map<string, { task: GanttTask; info: DependencyRowInfo }>();
  const add = (id: string) => {
    if (tasks.has(id)) return;
    const item = index.nodes.get(id);
    const task = item ? { ...item, id, children: undefined } : externalTask(index.externals.get(id)!);
    tasks.set(id, {
      task,
      info: { linked: !ids.has(id), external: !item, path: item ? index.paths.get(id) || undefined : undefined },
    });
  };
  for (const edge of edges) {
    add(edge.blocker);
    add(edge.blocked);
  }
  // The leaves of the critical path are shown, even those without a link of their own.
  const critical = criticalPath(index, full);
  critical.ids.forEach(add);

  // Kahn's algorithm: among the items whose blockers are all placed, the earliest first.
  const blockers = new Map<string, number>();
  const blocks = new Map<string, string[]>();
  for (const edge of edges) {
    blockers.set(edge.blocked, (blockers.get(edge.blocked) ?? 0) + 1);
    blocks.set(edge.blocker, [...(blocks.get(edge.blocker) ?? []), edge.blocked]);
  }
  const byDate = (a: string, b: string) => {
    const x = tasks.get(a)!.task;
    const y = tasks.get(b)!.task;
    return x.start.localeCompare(y.start) || x.end.localeCompare(y.end) || x.name.localeCompare(y.name) || a.localeCompare(b);
  };
  const pending = [...tasks.keys()].sort(byDate);
  const order: string[] = [];
  const placed = new Set<string>();
  while (pending.length > 0) {
    // In a cycle, no item is free: the earliest goes first.
    const next = pending.findIndex((id) => !blockers.get(id));
    const [id] = pending.splice(next === -1 ? 0 : next, 1);
    order.push(id);
    placed.add(id);
    for (const blocked of blocks.get(id) ?? []) {
      if (!placed.has(blocked)) blockers.set(blocked, (blockers.get(blocked) ?? 1) - 1);
    }
  }

  // The parent of each item of the subtree: its first placement, depth first.
  const rootId = gitlabId(full.id);
  const parents = new Map<string, GanttTask>();
  const visit = (parent: GanttTask) =>
    parent.children?.forEach((child) => {
      const id = gitlabId(child.id);
      if (id !== rootId && !parents.has(id)) parents.set(id, parent);
      visit(child);
    });
  visit(full);

  // The tree of the dialog: each item under its parent, up to the row (left out); a parent
  // without a link of its own is added for its place. Items from elsewhere at the top level.
  const nodes = new Map<string, GanttTask>();
  const roots: GanttTask[] = [];
  const context: DependencyRowInfo = { linked: false, external: false, context: true };
  const place = (id: string, task: GanttTask) => {
    nodes.set(id, task);
    const parent = parents.get(id);
    const parentId = parent && gitlabId(parent.id);
    if (!parent || !parentId || parentId === rootId || !ids.has(id)) {
      roots.push(task);
      return;
    }
    if (!nodes.has(parentId)) place(parentId, tasks.get(parentId)?.task ?? { ...parent, id: parentId, children: undefined });
    const into = nodes.get(parentId)!;
    into.children = [...(into.children ?? []), task];
  };
  for (const id of order) if (!nodes.has(id)) place(id, tasks.get(id)!.task);

  // Siblings by the earliest item with a link they hold, in the order above.
  const rank = new Map(order.map((id, position) => [id, position]));
  const ranks = new Map<GanttTask, number>();
  const rankOf = (task: GanttTask): number => {
    let value = ranks.get(task);
    if (value === undefined) {
      value = Math.min(rank.get(task.id) ?? Infinity, ...(task.children ?? []).map(rankOf));
      ranks.set(task, value);
    }
    return value;
  };
  const sort = (list: GanttTask[]) => {
    list.sort((a, b) => rankOf(a) - rankOf(b));
    list.forEach((task) => task.children && sort(task.children));
  };
  sort(roots);

  const rows = visibleRows(roots, new Set(nodes.keys())).map((row) => ({
    ...row,
    dependency: tasks.get(row.node.id)?.info ?? context,
  }));
  const links: DependencyLink[] = edges.map((edge) => {
    const blocker = tasks.get(edge.blocker)!.task;
    const blocked = tasks.get(edge.blocked)!.task;
    return { from: edge.blocker, to: edge.blocked, conflict: conflictBetween(blocker, blocked) !== undefined };
  });

  critical.ids.forEach((id) => (tasks.get(id)!.info.critical = true));
  const name = (id: string) => index.nodes.get(id)?.name ?? index.externals.get(id)?.name ?? id;
  for (const step of critical.steps) {
    if (step.direct) {
      links.find((link) => link.from === step.from && link.to === step.to)!.critical = true;
      continue;
    }
    // Through epics: a link of its own, dashed.
    const from = tasks.get(step.from)!.task;
    const to = tasks.get(step.to)!;
    links.push({ from: step.from, to: step.to, conflict: conflictBetween(from, to.task) !== undefined, critical: true, derived: true });
    to.info.criticalVia = `after ${from.name} (through ${name(step.edge.blocker)} → ${name(step.edge.blocked)})`;
  }
  return { rows, links, critical: critical.ids.length };
}
