import { GanttTask, GanttTaskType } from '../types/gantt';

/** A row shown in the chart: an item of the tree and its place in it. */
export interface Row {
  node: GanttTask;
  parentType?: GanttTaskType;
  hasChildren: boolean;
  depth: number; // 0 for top-level rows
  isLast: boolean; // last child of its parent
  // One entry per ancestor level below the top level: true when that ancestor has
  // siblings after it, i.e. when a vertical tree line must go through this row.
  guides: boolean[];
}

/** The rows actually shown, in order (each parent before its children): only the children
 * of expanded rows are visited, so the cost follows what is shown, not the size of the tree. */
export function visibleRows(nodes: GanttTask[], expanded: Set<string>): Row[] {
  const rows: Row[] = [];
  const visit = (list: GanttTask[], parent: GanttTask | undefined, depth: number, guides: boolean[]) => {
    list.forEach((node, index) => {
      const hasChildren = !!node.children && node.children.length > 0;
      const isLast = index === list.length - 1;
      rows.push({ node, parentType: parent?.type, hasChildren, depth, isLast, guides });
      if (hasChildren && expanded.has(node.id)) {
        // Top-level rows have no connector, so no line goes down from them.
        visit(node.children!, node, depth + 1, depth === 0 ? [] : [...guides, !isLast]);
      }
    });
  };
  visit(nodes, undefined, 0, []);
  return rows;
}

/** The tree without its closed items. A closed item's subtree goes with it: a closed epic
 * or milestone is done. Purely visual: progress values still include closed items. */
export function withoutClosed(nodes: GanttTask[]): GanttTask[] {
  return nodes
    .filter((node) => !node.closed)
    .map((node) => (node.children ? { ...node, children: withoutClosed(node.children) } : node));
}
