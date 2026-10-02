import { GanttTask, GanttTaskType, HealthStatus, Label } from '../types/gantt';
import { HEALTH_LABELS } from './health';

/** What the filter bar asks for: the types of items to show (all of them by default, none =
 * nothing), the labels they must carry (any of them), their health status (any of them),
 * whether they must be blocked and a text their name must contain. */
export interface Filters {
  search: string;
  types: GanttTaskType[];
  labels: string[]; // label titles
  health: HealthStatus[];
  blocked: boolean; // only items with an open blocker
}

export const ALL_TYPES: GanttTaskType[] = ['milestone', 'epic', 'issue'];

export const DEFAULT_FILTERS: Filters = { search: '', types: ALL_TYPES, labels: [], health: [], blocked: false };

export function isFiltering(filters: Filters): boolean {
  return (
    filters.search.trim() !== '' ||
    ALL_TYPES.some((type) => !filters.types.includes(type)) ||
    filters.labels.length > 0 ||
    filters.health.length > 0 ||
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
 * `_top` copy of their first occurrence. */
export function applyFilters(tree: GanttTask[], filters: Filters): GanttTask[] {
  if (!isFiltering(filters)) return tree;
  const search = normalizeText(filters.search.trim());
  const matches = (node: GanttTask) =>
    filters.types.includes(node.type) &&
    (filters.labels.length === 0 || hasLabel(node, filters.labels)) &&
    (filters.health.length === 0 || hasHealth(node, filters.health)) &&
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
