import React, { createContext, useContext } from 'react';
import { Task } from 'gantt-task-react';
import { FlatGanttTask } from '../utils/flatten';
import { ChevronIcon } from './Icons';
import { scheduleLabel, scheduleStatus } from '../utils/schedule';

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
}> = ({ headerHeight, rowWidth }) => (
  <div className="task-list-header" style={{ height: headerHeight, width: rowWidth }}>
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
}> = ({ rowHeight, rowWidth, tasks, onExpanderClick }) => {
  const rows = useContext(RowInfoContext);
  return (
    <div className="task-list">
      {tasks.map((task) => {
        const row = rows.get(task.id);
        const depth = row?.depth ?? 0;
        // hideChildren is only defined on groups: undefined means a leaf, without chevron.
        const isGroup = task.hideChildren !== undefined;
        const expanded = task.hideChildren === false;
        return (
          <div
            key={task.id}
            className="task-list-row"
            style={{ height: rowHeight }}
            data-depth={depth}
            data-parent-type={row?.parentType}
            data-expanded={expanded ? 'true' : undefined}
            data-schedule={isGroup && row ? scheduleStatus(row.progress, row.linearProgress) : undefined}
          >
            <div className="task-list-cell" style={{ width: rowWidth }} title={task.name}>
              {row?.guides.map((line, level) => (
                <span key={level} className={line ? 'tree-guide line' : 'tree-guide'} />
              ))}
              {depth > 0 && <span className={row?.isLast ? 'tree-branch last' : 'tree-branch'} />}
              {isGroup ? (
                <button
                  type="button"
                  className="chevron"
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                  aria-expanded={expanded}
                  onClick={() => onExpanderClick(task)}
                >
                  <ChevronIcon size={12} />
                </button>
              ) : (
                <span className="chevron-spacer" />
              )}
              {row && <span className="task-type-dot" style={{ background: `var(--${row.type})` }} />}
              <div className="task-list-name">{task.name}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const TooltipContent: React.FC<{ task: Task; fontSize: string; fontFamily: string }> = ({ task }) => {
  const row = useContext(RowInfoContext).get(task.id);
  const progress = Math.round(task.progress);
  // Epics and milestones also show their expected (linear) progress, drawn on their bar.
  const isGroup = task.type === 'project';
  const linear = row?.linearProgress ?? 0;
  const status = isGroup ? scheduleStatus(task.progress, linear) : undefined;
  return (
    <div className="gantt-tooltip" data-status={status}>
      <strong>{task.name}</strong>
      <p>
        From {formatDay(task.start)} to {formatDay(task.end)}
      </p>
      <p>{progress}% complete</p>
      {isGroup && (
        <p className="schedule" data-status={status}>
          Expected {Math.round(linear)}% · <strong>{scheduleLabel(task.progress, linear)}</strong>
        </p>
      )}
      <div className="progress-track">
        {isGroup && <div className="progress-linear" style={{ width: `${Math.min(100, linear)}%` }} />}
        <div className="progress-value" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};
