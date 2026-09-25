import { GanttTask, GanttTaskType } from '../types/gantt';

export interface FlatGanttTask extends Omit<GanttTask, 'children'> {
  parent?: string;
  parentType?: GanttTaskType;
  hasChildren: boolean;
  depth: number; // 0 for top-level rows
  isLast: boolean; // last child of its parent
  // One entry per ancestor level below the top level: true when that ancestor has
  // siblings after it, i.e. when a vertical tree line must go through this row.
  guides: boolean[];
}

// Depth-first flattening: each parent precedes its children,
// the order gantt-task-react expects.
export function flattenGanttTree(
  nodes: GanttTask[],
  parent?: GanttTask,
  depth = 0,
  guides: boolean[] = [],
): FlatGanttTask[] {
  let result: FlatGanttTask[] = [];
  nodes.forEach((node, index) => {
    const { children, ...flatNode } = node;
    const hasChildren = !!children && children.length > 0;
    const isLast = index === nodes.length - 1;
    result.push({ ...flatNode, parent: parent?.id, parentType: parent?.type, hasChildren, depth, isLast, guides });
    if (hasChildren) {
      // Top-level rows have no connector, so no line goes down from them.
      const childGuides = depth === 0 ? [] : [...guides, !isLast];
      result = result.concat(flattenGanttTree(children, node, depth + 1, childGuides));
    }
  });
  return result;
}

/** The rows actually shown, in order: those whose ancestors are all expanded. */
export function visibleRows(flat: FlatGanttTask[], expanded: Set<string>): FlatGanttTask[] {
  const shown = new Set<string>();
  return flat.filter((item) => {
    const visible = !item.parent || (shown.has(item.parent) && expanded.has(item.parent));
    if (visible) shown.add(item.id);
    return visible;
  });
}
