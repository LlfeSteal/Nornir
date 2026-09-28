// Schedule status of an epic or milestone, from its real progress and its linear progress
// (the progress expected today if the work advanced evenly over its dates). The gap is in
// percentage points: expected 80%, done 77% → 3 points behind.

export type ScheduleStatus = 'on-track' | 'at-risk' | 'late';

/** Up to this many points behind, a row is "at risk" (orange); beyond, "late" (red). */
export const SCHEDULE_THRESHOLD = 5;

/** Points behind the linear progress (negative when ahead), rounded to 0.1 to avoid float noise. */
function pointsBehind(progress: number, linear: number): number {
  return Math.round((linear - progress) * 10) / 10;
}

export function scheduleStatus(progress: number, linear: number): ScheduleStatus {
  const gap = pointsBehind(progress, linear);
  if (gap <= 0) return 'on-track';
  return gap <= SCHEDULE_THRESHOLD ? 'at-risk' : 'late';
}

/** The status in words, e.g. "On track · 30% ahead" or "3% behind". */
export function scheduleLabel(progress: number, linear: number): string {
  const gap = pointsBehind(progress, linear);
  if (gap > 0) return `${Math.max(1, Math.round(gap))}% behind`;
  const ahead = Math.round(-gap);
  return ahead >= 1 ? `On track · ${ahead}% ahead` : 'On track';
}

/** Why a row's dates can't be trusted (made up by the backend), or undefined when GitLab
 * has both. Such rows get no schedule status. */
export function missingDatesMessage(row: { noStartDate?: boolean; noDueDate?: boolean }): string | undefined {
  if (row.noStartDate && row.noDueDate) return 'No dates in GitLab';
  if (row.noStartDate) return 'No start date in GitLab';
  if (row.noDueDate) return 'No due date in GitLab';
  return undefined;
}
