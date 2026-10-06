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

/** A subgroup of the displayed group, at any level. */
export interface Subgroup {
  path: string;            // Relative to the group, e.g. "team/backend"
  name: string;
}

/** The other end of a GitLab blocking link (see the backend's DependencyRef). */
export interface DependencyRef {
  id: string;              // GitLab global ID, never suffixed
  name: string;
  webUrl?: string;
  start: string;
  end: string;
  closed?: boolean;
  noStartDate?: boolean;
  noDueDate?: boolean;
  external?: boolean;      // Not in the group's data (another group or project)
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
  noChildren?: boolean;    // Open epic or milestone without any child item in GitLab
  labels?: Label[];
  subgroup?: string;       // GitLab subgroup, path relative to the group; none in the group itself
  health?: HealthStatus;   // Own GitLab health status
  healthBelow?: HealthCounts; // Open descendants at risk / needing attention, when any
  blockedBy?: DependencyRef[]; // GitLab "blocked by" links (work items only)
  blocking?: DependencyRef[];  // GitLab "blocks" links
  children?: GanttTask[];  // Recursive children
}
