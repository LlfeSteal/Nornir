import React from 'react';
import { Task } from 'gantt-task-react';

// Replacements for gantt-task-react's list and tooltip: the list shows only the item
// names (no From/To columns), and the dates move to the tooltip shown on a bar.

const dateFormat: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

export function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', dateFormat);
}

export const TaskListHeader: React.FC<{
  headerHeight: number;
  rowWidth: string;
  fontFamily: string;
  fontSize: string;
}> = ({ headerHeight, rowWidth, fontFamily, fontSize }) => (
  <div className="task-list-header" style={{ height: headerHeight - 2, width: rowWidth, fontFamily, fontSize }}>
    Name
  </div>
);

export const TaskListTable: React.FC<{
  rowHeight: number;
  rowWidth: string;
  fontFamily: string;
  fontSize: string;
  locale: string;
  tasks: Task[];
  selectedTaskId: string;
  setSelectedTask: (taskId: string) => void;
  onExpanderClick: (task: Task) => void;
}> = ({ rowHeight, rowWidth, fontFamily, fontSize, tasks, onExpanderClick }) => (
  <div className="task-list" style={{ fontFamily, fontSize }}>
    {tasks.map((task) => {
      // hideChildren is only defined on groups: undefined means a leaf, without expander.
      const expander = task.hideChildren === undefined ? '' : task.hideChildren ? '▶' : '▼';
      return (
        <div key={task.id} className="task-list-row" style={{ height: rowHeight }}>
          <div className="task-list-cell" style={{ width: rowWidth }} title={task.name}>
            <div
              className={expander ? 'task-list-expander' : 'task-list-expander empty'}
              onClick={() => expander && onExpanderClick(task)}
            >
              {expander}
            </div>
            <div className="task-list-name">{task.name}</div>
          </div>
        </div>
      );
    })}
  </div>
);

export const TooltipContent: React.FC<{ task: Task; fontSize: string; fontFamily: string }> = ({
  task,
  fontSize,
  fontFamily,
}) => (
  <div className="gantt-tooltip" style={{ fontSize, fontFamily }}>
    <strong>{task.name}</strong>
    <p>
      From {formatDay(task.start)} to {formatDay(task.end)}
    </p>
    <p>Progress: {Math.round(task.progress)} %</p>
  </div>
);
