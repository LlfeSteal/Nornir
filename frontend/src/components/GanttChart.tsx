import React, { useMemo, useState } from 'react';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { GanttTask, GanttTaskType } from '../types/gantt';
import { flattenGanttTree } from '../utils/flatten';

interface Props {
  data: GanttTask[];
}

const COLORS: Record<GanttTaskType, string> = {
  milestone: '#6b46c1',
  epic: '#3182ce',
  issue: '#38a169',
};

const VIEW_MODES: { label: string; mode: ViewMode }[] = [
  { label: 'Day', mode: ViewMode.Day },
  { label: 'Week', mode: ViewMode.Week },
  { label: 'Month', mode: ViewMode.Month },
];

// "YYYY-MM-DD" → local midnight (new Date("YYYY-MM-DD") would be parsed as UTC).
function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const GanttChart: React.FC<Props> = ({ data }) => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { tasks, urls } = useMemo(() => {
    const flatItems = flattenGanttTree(data);
    const urls = new Map<string, string>();
    const tasks: Task[] = flatItems.map((item) => {
      if (item.webUrl) urls.set(item.id, item.webUrl);
      const color = COLORS[item.type];
      // Any item with children becomes a collapsible "project".
      const isGroup = item.type === 'milestone' || item.hasChildren;
      return {
        start: parseDay(item.start),
        end: parseDay(item.end),
        name: item.name,
        id: item.id,
        type: isGroup ? 'project' : 'task',
        progress: item.progress || 0,
        project: item.parent,
        hideChildren: isGroup ? collapsed.has(item.id) : undefined,
        styles: {
          backgroundColor: color,
          backgroundSelectedColor: '#2b6cb0',
          progressColor: '#1a202c55',
          progressSelectedColor: '#1a202c88',
        },
      };
    });
    return { tasks, urls };
  }, [data, collapsed]);

  const toggle = (task: Task) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  };

  const openInGitLab = (task: Task) => {
    const url = urls.get(task.id);
    if (url) window.open(url, '_blank', 'noopener');
  };

  if (tasks.length === 0) return <p className="empty">No data to display.</p>;

  return (
    <div className="gantt">
      <div className="toolbar">
        {VIEW_MODES.map(({ label, mode }) => (
          <button
            key={mode}
            type="button"
            className={mode === viewMode ? 'active' : undefined}
            onClick={() => setViewMode(mode)}
          >
            {label}
          </button>
        ))}
        <span className="hint">Double-click a bar to open the item in GitLab</span>
      </div>
      <Gantt
        tasks={tasks}
        viewMode={viewMode}
        locale="en"
        listCellWidth="220px"
        columnWidth={viewMode === ViewMode.Month ? 200 : viewMode === ViewMode.Week ? 120 : 50}
        onExpanderClick={toggle}
        onDoubleClick={openInGitLab}
      />
    </div>
  );
};
