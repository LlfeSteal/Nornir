import React, { createContext, useContext } from 'react';
import { Task } from 'gantt-task-react';
import { FlatGanttTask } from '../utils/flatten';
import { groupBand, TYPE_COLORS } from '../utils/colors';

// Replacements for gantt-task-react's list and tooltip: the list shows only the item
// names (no From/To columns), and the dates move to the tooltip shown on a bar.

/** Tree position of each row by task ID, provided by GanttChart (the library only
 * hands its own Task objects to the list). */
export const RowInfoContext = createContext<Map<string, FlatGanttTask>>(new Map());

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
}> = ({ rowHeight, rowWidth, fontFamily, fontSize, tasks, onExpanderClick }) => {
  const rows = useContext(RowInfoContext);
  return (
    <div className="task-list" style={{ fontFamily, fontSize }}>
      {tasks.map((task) => {
        // hideChildren is only defined on groups: undefined means a leaf, without expander.
        const expander = task.hideChildren === undefined ? '' : task.hideChildren ? '▶' : '▼';
        const row = rows.get(task.id);
        const depth = row?.depth ?? 0;
        // Rows inside an expanded group are tinted in the group's color.
        const groupStyle = row?.parentType
          ? ({ '--group-color': TYPE_COLORS[row.parentType], '--group-band': groupBand(row.parentType) } as React.CSSProperties)
          : {};
        return (
          <div
            key={task.id}
            className="task-list-row"
            style={{ height: rowHeight, ...groupStyle }}
            data-depth={depth}
            data-parent-type={row?.parentType}
            data-expanded={task.hideChildren === false ? 'true' : undefined}
          >
            <div className="task-list-cell" style={{ width: rowWidth }} title={task.name}>
              {/* Tree connectors, drawn in CSS so they join from row to row. */}
              {row?.guides.map((line, level) => (
                <span key={level} className={line ? 'tree-guide line' : 'tree-guide'} />
              ))}
              {depth > 0 && <span className={row?.isLast ? 'tree-branch last' : 'tree-branch'} />}
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
};

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
