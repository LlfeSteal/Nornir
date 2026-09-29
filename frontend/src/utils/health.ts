import { GanttTask, HealthCounts, HealthStatus } from '../types/gantt';

// GitLab health status of the rows. A row is flagged by the worse of its own status (while
// it is open) and those of its open descendants (`healthBelow`, counted by the backend):
// at risk beats needs attention; "on track" is never flagged.

export type HealthLevel = 'atRisk' | 'needsAttention';

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  atRisk: 'At risk',
  needsAttention: 'Needs attention',
  onTrack: 'On track',
};

/** The flag of a row, from its own status or its descendants', undefined when it has none
 * (closed rows aren't flagged). */
export function rowHealth(node: GanttTask): HealthLevel | undefined {
  if (node.closed) return undefined;
  if (node.health === 'atRisk' || node.healthBelow?.atRisk) return 'atRisk';
  if (node.health === 'needsAttention' || node.healthBelow?.needsAttention) return 'needsAttention';
  return undefined;
}

/** "2 at risk · 1 needs attention". */
export function healthCountsMessage(counts: HealthCounts): string {
  const parts: string[] = [];
  if (counts.atRisk) parts.push(`${counts.atRisk} at risk`);
  if (counts.needsAttention) {
    parts.push(`${counts.needsAttention} ${counts.needsAttention === 1 ? 'needs' : 'need'} attention`);
  }
  return parts.join(' · ');
}

/** Help tag of the flag: the row's own status and what its descendants have, e.g.
 * "At risk · 3 needs attention below". */
export function healthMessage(node: GanttTask): string {
  const parts: string[] = [];
  if (node.health === 'atRisk' || node.health === 'needsAttention') parts.push(HEALTH_LABELS[node.health]);
  if (node.healthBelow) parts.push(`${healthCountsMessage(node.healthBelow)} below`);
  return parts.join(' · ');
}
