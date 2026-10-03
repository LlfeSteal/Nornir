import { GanttTask } from '../types/gantt';
import { blockerConflicts, openBlockers } from './dependencies';
import { canonicalId } from './filters';
import { overrun } from './overrun';
import { missingDatesMessage, noChildrenMessage, scheduleStatus } from './schedule';

// What needs attention in the chart, counted per item for the summary strip and used by its
// filters. Closed items never count: their work is done.

export type AttentionFlag =
  | 'late'
  | 'behind'
  | 'atRisk'
  | 'needsAttention'
  | 'blocked'
  | 'conflict'
  | 'pastParent'
  | 'noDates'
  | 'noChildren';

export const ATTENTION_FLAGS: AttentionFlag[] = [
  'late',
  'behind',
  'atRisk',
  'needsAttention',
  'blocked',
  'conflict',
  'pastParent',
  'noDates',
  'noChildren',
];

/** The GitLab IDs (`canonicalId`) of the items raising each flag: each item once, whatever
 * its copies. */
export type AttentionIndex = Map<AttentionFlag, Set<string>>;

/** The flags of an item shown under `parent` (none at the top level). Late / behind only for
 * groups (milestones, items with children) whose status means something, as in the chart. */
export function attentionFlags(node: GanttTask, parent: GanttTask | undefined): AttentionFlag[] {
  if (node.closed) return [];
  const flags: AttentionFlag[] = [];
  const isGroup = node.type === 'milestone' || (node.children?.length ?? 0) > 0;
  const missingDates = missingDatesMessage(node);
  const empty = noChildrenMessage(node);
  if (isGroup && !missingDates && !empty) {
    const status = scheduleStatus(node.progress, node.linearProgress);
    if (status === 'late') flags.push('late');
    else if (status === 'at-risk') flags.push('behind');
  }
  if (node.health === 'atRisk') flags.push('atRisk');
  if (node.health === 'needsAttention') flags.push('needsAttention');
  if (openBlockers(node).length > 0) flags.push('blocked');
  if (blockerConflicts(node).length > 0) flags.push('conflict');
  if (overrun(node, parent)) flags.push('pastParent');
  if (missingDates) flags.push('noDates');
  if (empty) flags.push('noChildren');
  return flags;
}

/** One walk over the whole tree (collapsed rows included), each placement judged against its
 * own parent: an item is past its parent when any of its placements is. */
export function attentionIndex(tree: GanttTask[]): AttentionIndex {
  const index: AttentionIndex = new Map(ATTENTION_FLAGS.map((flag) => [flag, new Set<string>()]));
  const visit = (list: GanttTask[], parent: GanttTask | undefined) => {
    for (const node of list) {
      for (const flag of attentionFlags(node, parent)) index.get(flag)!.add(canonicalId(node.id));
      if (node.children) visit(node.children, node);
    }
  };
  visit(tree, undefined);
  return index;
}
