import { DependencyRef, GanttTask } from '../types/gantt';
import { canonicalId, TOP_COPY_SUFFIX } from './filters';
import { Row } from './flatten';
import { parseDay } from './timeline';

// GitLab "blocked by" / "blocks" links. In the chart: a mark on blocked rows and a red hatch on
// the part of a bar planned before its blocker ends. A row whose subtree holds links opens them in a
// dialog: a flat chart of the items involved, with arrows from each blocker to what it blocks.

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
  counts: WeakMap<GanttTask, number>;
}

/** Indexes the links of a tree (closed items hidden or not, as shown). A link counts when both
 * ends are shown: an item of the tree, or an item outside the group (closed ones only with
 * `includeClosed`). */
export function dependencyIndex(tree: GanttTask[], includeClosed: boolean): DependencyIndex {
  const nodes = new Map<string, GanttTask>();
  const paths = new Map<string, string>();
  const visit = (list: GanttTask[], path: string) =>
    list.forEach((node) => {
      const id = gitlabId(node.id);
      if (!nodes.has(id)) {
        nodes.set(id, node);
        paths.set(id, path);
      }
      if (node.children) visit(node.children, path ? `${path} › ${node.name}` : node.name);
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
  return { edges, nodes, paths, externals, byItem, counts: new WeakMap() };
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

/** The links touching an item or its descendants, each once. */
function subtreeEdges(index: DependencyIndex, node: GanttTask): { ids: Set<string>; edges: Edge[] } {
  const ids = subtreeIds(node);
  const edges = new Set<Edge>();
  for (const id of ids) index.byItem.get(id)?.forEach((edge) => edges.add(edge));
  return { ids, edges: [...edges] };
}

/** How many links touch a row's item or its descendants (whatever the filters hide). */
export function dependencyCount(index: DependencyIndex, node: GanttTask): number {
  if (index.edges.length === 0) return 0;
  const full = fullNode(index, node);
  let count = index.counts.get(full);
  if (count === undefined) {
    count = subtreeEdges(index, full).edges.length;
    index.counts.set(full, count);
  }
  return count;
}

/** A row of the dependencies dialog: an item of the row's subtree, or a linked item found
 * elsewhere in the group (`path`) or outside it (`external`). */
export interface DependencyRowInfo {
  linked: boolean;
  external: boolean;
  path?: string;
}

export interface DependencyLink {
  from: string; // row IDs (GitLab IDs)
  to: string;
  conflict: boolean;
}

export interface DependencySubgraph {
  rows: Row[];
  links: DependencyLink[];
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

/** The dependencies of a row and its descendants, as flat rows: the items of its subtree that
 * have links, then the items they're linked to elsewhere, in dependency order (a blocker
 * before what it blocks; by start date otherwise, and in a cycle). */
export function dependencySubgraph(index: DependencyIndex, node: GanttTask): DependencySubgraph {
  const full = fullNode(index, node);
  const { ids, edges } = subtreeEdges(index, full);

  const tasks = new Map<string, { task: GanttTask; info: DependencyRowInfo }>();
  for (const edge of edges) {
    for (const id of [edge.blocker, edge.blocked]) {
      if (tasks.has(id)) continue;
      const item = index.nodes.get(id);
      const inside = ids.has(id);
      const task = item ? { ...item, id, children: undefined } : externalTask(index.externals.get(id)!);
      tasks.set(id, {
        task,
        info: { linked: !inside, external: !item, path: item ? index.paths.get(id) || undefined : undefined },
      });
    }
  }

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

  const rows: Row[] = order.map((id) => {
    const { task, info } = tasks.get(id)!;
    return { node: task, hasChildren: false, depth: 0, isLast: false, guides: [], dependency: info };
  });
  const links = edges.map((edge) => {
    const blocker = tasks.get(edge.blocker)!.task;
    const blocked = tasks.get(edge.blocked)!.task;
    return { from: edge.blocker, to: edge.blocked, conflict: conflictBetween(blocker, blocked) !== undefined };
  });
  return { rows, links };
}
