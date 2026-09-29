export type GanttTaskType = 'milestone' | 'epic' | 'issue';

/** GitLab health status of a work item. */
export type HealthStatus = 'onTrack' | 'needsAttention' | 'atRisk';

/** Open descendants of a row, by health status (each counted once). */
export interface HealthCounts {
  atRisk: number;
  needsAttention: number;
}

export interface Label {
  title: string;
  color: string;           // Hex color from GitLab, e.g. "#428bca"
}

export interface GanttTask {
  id: string;
  name: string;
  type: GanttTaskType;
  start: string;           // ISO format: "YYYY-MM-DD"
  end: string;             // ISO format: "YYYY-MM-DD"
  progress: number;        // Value between 0 and 100
  linearProgress: number;  // Progress expected today from the dates (0 to 100)
  webUrl?: string;
  closed?: boolean;        // Closed work item or milestone
  noStartDate?: boolean;   // No start date in GitLab: `start` is made up
  noDueDate?: boolean;     // No due date in GitLab: `end` is made up
  labels?: Label[];
  health?: HealthStatus;   // Own GitLab health status
  healthBelow?: HealthCounts; // Open descendants at risk / needing attention, when any
  children?: GanttTask[];  // Recursive children
}
