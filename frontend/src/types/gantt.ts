export type GanttTaskType = 'milestone' | 'epic' | 'issue';

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
  labels?: Label[];
  children?: GanttTask[];  // Recursive children
}
