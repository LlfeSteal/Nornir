import { GanttTask, GanttTaskType, HealthStatus, Label, Subgroup } from '../types/gantt';
import type { AttentionFlag, AttentionIndex } from './attention';
import { HEALTH_LABELS } from './health';

/** What the filter bar asks for: the types of items to show (all of them by default, none =
 * nothing), the labels they must carry (any of them), the GitLab subgroups they belong to (any
 * of them), their health status (any of them), what needs attention (any of it), whether they
 * must be blocked and a text their name must contain. */
export interface Filters {
  search: string;
  types: GanttTaskType[];
  labels: string[]; // label titles
  subgroups: string[]; // subgroup paths relative to the group, or MAIN_GROUP
  health: HealthStatus[];
  attention: AttentionFlag[]; // see attention.ts
  blocked: boolean; // only items with an open blocker
}

export const ALL_TYPES: GanttTaskType[] = ['milestone', 'epic', 'issue'];

export const DEFAULT_FILTERS: Filters = {
  search: '',
  types: ALL_TYPES,
  labels: [],
  subgroups: [],
  health: [],
  attention: [],
  blocked: false,
};

/** The subgroup filter's value for the items of the group itself (outside its subgroups). */
export const MAIN_GROUP = '.';

export function isFiltering(filters: Filters): boolean {
  return (
    filters.search.trim() !== '' ||
    ALL_TYPES.some((type) => !filters.types.includes(type)) ||
    filters.labels.length > 0 ||
    filters.subgroups.length > 0 ||
    filters.health.length > 0 ||
    filters.attention.length > 0 ||
    filters.blocked
  );
}

/** Lower case, without accents: "Élan" and "elan" match. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** The GitLab ID of a row, without the suffix of its copy (`_ms_<id>`, `_root_<id>`, see
 * the backend's tree_builder.go). */
export function canonicalId(id: string): string {
  return id.replace(/_(ms|root)_[^_]*$/, '');
}

/** Suffix of the top-level copy of an issue in a filtered list (and of its subtree): the
 * issue may also be shown under an epic of the same list. */
export const TOP_COPY_SUFFIX = '_top';

function withSuffix(node: GanttTask, suffix: string): GanttTask {
  return {
    ...node,
    id: node.id + suffix,
    children: node.children?.map((child) => withSuffix(child, suffix)),
  };
}

/** Whether the item carries one of the labels. Milestones have no labels of their own: they
 * count as labeled when one of their items is. */
function hasLabel(node: GanttTask, labels: string[]): boolean {
  if (node.labels?.some((label) => labels.includes(label.title))) return true;
  return node.type === 'milestone' && !!node.children?.some((child) => hasLabel(child, labels));
}

/** Whether the item belongs to one of the subgroups: a subgroup holds the items of its own
 * subgroups too, MAIN_GROUP the items outside every subgroup. Milestones belong to no group:
 * they match when one of their items does. */
function inSubgroup(node: GanttTask, subgroups: string[]): boolean {
  if (node.type === 'milestone') return !!node.children?.some((child) => inSubgroup(child, subgroups));
  const own = node.subgroup;
  return subgroups.some((path) => (path === MAIN_GROUP ? !own : !!own && (own === path || own.startsWith(`${path}/`))));
}

/** Whether the item's own health status is one of these. Milestones have none: they match
 * when one of their open items does. */
function hasHealth(node: GanttTask, health: HealthStatus[]): boolean {
  if (node.type !== 'milestone') return !!node.health && health.includes(node.health);
  const openMatch = (list?: GanttTask[]): boolean =>
    !!list?.some((child) => (!child.closed && hasHealth(child, health)) || openMatch(child.children));
  return openMatch(node.children);
}

/** The options of the Health menu, worst first. */
export const HEALTH_OPTIONS: FilterOption[] = (['atRisk', 'needsAttention', 'onTrack'] as HealthStatus[]).map((status) => ({
  value: status,
  label: HEALTH_LABELS[status],
  color: `var(--health-${status === 'atRisk' ? 'at-risk' : status === 'needsAttention' ? 'needs-attention' : 'on-track'})`,
}));

/** The items to show. Without filters, the tree itself. Otherwise a flat list of the matching
 * milestones, then epics, then issues, each shown once with its whole content: milestones
 * and epics through their top-level row (the tree has one per epic), issues through a
 * `_top` copy of their first occurrence. The attention flags need the `attentionIndex` of
 * the tree. */
export function applyFilters(tree: GanttTask[], filters: Filters, attention?: AttentionIndex): GanttTask[] {
  if (!isFiltering(filters)) return tree;
  const search = normalizeText(filters.search.trim());
  const flagged = (node: GanttTask) => {
    const id = canonicalId(node.id);
    return filters.attention.some((flag) => attention?.get(flag)?.has(id));
  };
  const matches = (node: GanttTask) =>
    filters.types.includes(node.type) &&
    (filters.labels.length === 0 || hasLabel(node, filters.labels)) &&
    (filters.subgroups.length === 0 || inSubgroup(node, filters.subgroups)) &&
    (filters.health.length === 0 || hasHealth(node, filters.health)) &&
    (filters.attention.length === 0 || flagged(node)) &&
    (!filters.blocked || !!node.blockedBy?.some((ref) => !ref.closed)) &&
    (!search || normalizeText(node.name).includes(search));

  const issues: GanttTask[] = [];
  const seenIssues = new Set<string>();
  const collectIssues = (list: GanttTask[]) =>
    list.forEach((node) => {
      if (node.type === 'issue' && !seenIssues.has(canonicalId(node.id))) {
        seenIssues.add(canonicalId(node.id));
        issues.push(node);
      }
      if (node.children) collectIssues(node.children);
    });
  collectIssues(tree);

  return [
    ...tree.filter((node) => node.type === 'milestone' && matches(node)),
    ...tree.filter((node) => node.type === 'epic' && matches(node)),
    ...issues.filter(matches).map((issue) => withSuffix(issue, TOP_COPY_SUFFIX)),
  ];
}

export interface FilterOption {
  value: string;
  label: string;
  detail?: string; // secondary text
  depth?: number; // indentation level, for a hierarchy (dropped while searching)
  context?: string; // where the option sits in the hierarchy: shown and searched while searching
  color?: string; // dot color, e.g. the label's
  section?: string; // options are grouped under their section title, in order
}

const byTitle = (a: Label, b: Label) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

/** The labels used in the chart first (including project labels, which only show up on the
 * items), then the group's other labels: a large group has thousands. */
export function labelOptions(groupLabels: Label[], tree: GanttTask[]): FilterOption[] {
  const used = new Map<string, Label>();
  const collect = (list: GanttTask[]) =>
    list.forEach((node) => {
      node.labels?.forEach((label) => used.has(label.title) || used.set(label.title, label));
      if (node.children) collect(node.children);
    });
  collect(tree);
  const others = groupLabels.filter((label) => !used.has(label.title));
  const option = (section: string) => (label: Label) => ({ value: label.title, label: label.title, color: label.color, section });
  return [
    ...[...used.values()].sort(byTitle).map(option('In this chart')),
    ...[...others].sort(byTitle).map(option('Other labels')),
  ];
}

/** The options of the Subgroups menu: the group's own items first, then every subgroup in
 * path order (a subgroup right before its own), indented by level. The subgroups come from
 * /api/subgroups, plus those found on the items (and their parents) in case it hasn't
 * answered: named after their last path segment then. groupPath: the displayed group. */
export function subgroupOptions(groupPath: string, subgroups: Subgroup[], tree: GanttTask[]): FilterOption[] {
  const names = new Map<string, string>();
  const collect = (list: GanttTask[]) =>
    list.forEach((node) => {
      for (let path = node.subgroup; path && !names.has(path); path = path.slice(0, Math.max(path.lastIndexOf('/'), 0))) {
        names.set(path, path.slice(path.lastIndexOf('/') + 1));
      }
      if (node.children) collect(node.children);
    });
  collect(tree);
  subgroups.forEach((subgroup) => names.set(subgroup.path, subgroup.name));
  if (names.size === 0) return [];
  const group = groupPath.slice(groupPath.lastIndexOf('/') + 1) || 'Group';
  const paths = [...names.keys()].sort((a, b) => {
    // Compare segment by segment so that "a/b" comes right after "a", before "a-c".
    const x = a.toLowerCase().split('/');
    const y = b.toLowerCase().split('/');
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    }
    return x.length - y.length;
  });
  return [
    { value: MAIN_GROUP, label: `${group} (outside subgroups)` },
    ...paths.map((path) => {
      const cut = path.lastIndexOf('/');
      return { value: path, label: names.get(path)!, depth: path.split('/').length, context: cut > 0 ? path.slice(0, cut) : undefined };
    }),
  ];
}
