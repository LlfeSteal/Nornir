import { GanttTask } from '../types/gantt';
import { parseDay } from './timeline';

// A row planned past its parent's end: the part of its bar beyond the parent's end is hatched
// in red. The parent is the row it is shown under (its epic, or its milestone), so each copy
// is judged against its own parent. Starting before the parent isn't flagged.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Overrun {
  from: Date; // the parent's end
  to: Date; // the row's end
  days: number;
}

/** How far the row ends past its parent's end, undefined when it doesn't, when either due
 * date is made up (missing in GitLab), or when the row is closed (its work is done). */
export function overrun(node: GanttTask, parent: GanttTask | undefined): Overrun | undefined {
  if (!parent || node.closed || node.noDueDate || parent.noDueDate) return undefined;
  const from = parseDay(parent.end);
  const to = parseDay(node.end);
  if (to <= from) return undefined;
  // Rounded: a day across a daylight saving change is 23 or 25 hours long.
  return { from, to, days: Math.round((to.getTime() - from.getTime()) / DAY_MS) };
}

/** "Ends 3 days after Payments". */
export function overrunMessage(value: Overrun, parent: GanttTask): string {
  return `Ends ${value.days} ${value.days === 1 ? 'day' : 'days'} after ${parent.name}`;
}
