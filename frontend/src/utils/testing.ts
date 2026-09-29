import { GanttTask } from '../types/gantt';

/** A tree node for unit tests: an open issue in October 2026 unless told otherwise. */
export function task(id: string, fields: Partial<GanttTask> = {}): GanttTask {
  return { id, name: id, type: 'issue', start: '2026-10-01', end: '2026-10-10', progress: 0, linearProgress: 0, ...fields };
}
