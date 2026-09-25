export type GanttTaskType = 'milestone' | 'epic' | 'issue';

export interface GanttTask {
  id: string;
  name: string;
  type: GanttTaskType;
  start: string;           // ISO format: "YYYY-MM-DD"
  end: string;             // ISO format: "YYYY-MM-DD"
  progress: number;        // Value between 0 and 100
  webUrl?: string;
  children?: GanttTask[];  // Recursive children
}
