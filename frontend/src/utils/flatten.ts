import { GanttTask } from '../types/gantt';

export interface FlatGanttTask extends Omit<GanttTask, 'children'> {
  parent?: string;
  hasChildren: boolean;
}

// Depth-first flattening: each parent precedes its children,
// the order gantt-task-react expects.
export function flattenGanttTree(
  nodes: GanttTask[],
  parentId?: string
): FlatGanttTask[] {
  let result: FlatGanttTask[] = [];
  for (const node of nodes) {
    const { children, ...flatNode } = node;
    const hasChildren = !!children && children.length > 0;
    result.push({ ...flatNode, parent: parentId, hasChildren });
    if (hasChildren) {
      result = result.concat(flattenGanttTree(children, node.id));
    }
  }
  return result;
}
