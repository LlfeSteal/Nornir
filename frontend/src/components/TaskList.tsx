import React from 'react';
import { Row } from '../utils/flatten';
import { ChevronIcon, HealthBadge, WarningFillIcon } from './Icons';
import { missingDatesMessage, noChildrenMessage, rowWarnings, scheduleLabel, scheduleStatus } from '../utils/schedule';
import { parseDay } from '../utils/timeline';
import { HEALTH_LABELS, healthCountsMessage, healthMessage, rowHealth } from '../utils/health';
import { overrun, overrunMessage } from '../utils/overrun';

// The list side of a chart row (only the item's name, the dates are in the tooltip) and the
// tooltip shown on a bar.

const dateFormat: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

export function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', dateFormat);
}

/** Schedule status of a group row (epic, milestone or any item with children), undefined
 * for leaves and for rows whose status means nothing (closed, dates made up, no child items
 * to take the progress from). */
export function rowSchedule(row: Row) {
  const { node } = row;
  const isGroup = node.type === 'milestone' || row.hasChildren;
  if (!isGroup || node.closed || missingDatesMessage(node) || noChildrenMessage(node)) return undefined;
  return scheduleStatus(node.progress, node.linearProgress);
}

export const TaskListHeader: React.FC = () => <div className="task-list-header">Name</div>;

export const TaskListRow: React.FC<{
  row: Row;
  expanded: boolean;
  onToggle: (id: string) => void;
}> = ({ row, expanded, onToggle }) => {
  const { node, depth } = row;
  const isGroup = node.type === 'milestone' || row.hasChildren;
  const missingDates = missingDatesMessage(node);
  const warnings = rowWarnings(node);
  const health = rowHealth(node);
  return (
    <div
      className="task-list-row"
      data-depth={depth}
      data-parent-type={row.parentType}
      data-expanded={isGroup && expanded ? 'true' : undefined}
      data-schedule={rowSchedule(row)}
      data-closed={node.closed ? 'true' : undefined}
      data-undated={missingDates ? 'true' : undefined}
      data-empty={noChildrenMessage(node) ? 'true' : undefined}
      data-health={health}
    >
      <div className="task-list-cell" title={node.name}>
        {row.guides.map((line, level) => (
          <span key={level} className={line ? 'tree-guide line' : 'tree-guide'} />
        ))}
        {depth > 0 && <span className={row.isLast ? 'tree-branch last' : 'tree-branch'} />}
        {/* Milestones are groups even when empty; only items with children can open. */}
        {row.hasChildren ? (
          <button
            type="button"
            className="chevron"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expanded}
            onClick={() => onToggle(node.id)}
          >
            <ChevronIcon size={12} />
          </button>
        ) : (
          <span className="chevron-spacer" />
        )}
        <span className="task-type-dot" style={{ background: `var(--${node.type})` }} />
        <div className="task-list-name">{node.name}</div>
        {/* Trailing accessories, like a macOS / iOS table cell: aligned from row to row. */}
        {(warnings.length > 0 || health) && (
          <span className="row-accessories">
            {/* One triangle for every warning, one line each in its help tag. */}
            {warnings.length > 0 && (
              <span className="row-warning" role="img" aria-label={warnings.join('. ')} title={warnings.join('\n')}>
                <WarningFillIcon />
              </span>
            )}
            {health && <HealthBadge level={health} label={healthMessage(node)} />}
          </span>
        )}
      </div>
    </div>
  );
};

export const TooltipContent: React.FC<{ row: Row }> = ({ row }) => {
  const { node } = row;
  const progress = Math.round(node.progress);
  const closed = !!node.closed;
  const linear = node.linearProgress;
  // Without dates in GitLab, the dates shown are made up: no schedule status.
  const missingDates = missingDatesMessage(node);
  const warnings = rowWarnings(node);
  const schedule = rowSchedule(row);
  const status = closed ? 'closed' : schedule;
  const past = overrun(node, row.parent);
  return (
    <div className="gantt-tooltip" role="tooltip" data-status={status} data-undated={missingDates ? 'true' : undefined}>
      <strong>{node.name}</strong>
      {/* The real dates: the bar may be cut at the edges of the period shown. */}
      <p>
        From {formatDay(parseDay(node.start))} to {formatDay(parseDay(node.end))}
      </p>
      <p>{progress}% complete</p>
      {closed && (
        <p className="schedule" data-status="closed">
          <strong>Closed</strong>
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="warning-note">
          <WarningFillIcon size={12} />
          <strong>{warning}</strong>
        </p>
      ))}
      {past && row.parent && (
        <p className="overrun-note">
          <strong>{overrunMessage(past, row.parent)}</strong>
        </p>
      )}
      {node.health && (
        <p className="health-note" data-health={node.health}>
          {node.health !== 'onTrack' && <HealthBadge level={node.health} size={12} />}
          Health: <strong>{HEALTH_LABELS[node.health]}</strong>
        </p>
      )}
      {node.healthBelow && (
        <p className="health-note" data-health={node.healthBelow.atRisk ? 'atRisk' : 'needsAttention'}>
          <HealthBadge level={node.healthBelow.atRisk ? 'atRisk' : 'needsAttention'} size={12} />
          Below: <strong>{healthCountsMessage(node.healthBelow)}</strong>
        </p>
      )}
      {schedule && (
        <p className="schedule" data-status={status}>
          Expected {Math.round(linear)}% · <strong>{scheduleLabel(progress, linear)}</strong>
        </p>
      )}
      <div className="progress-track">
        {schedule && <div className="progress-linear" style={{ width: `${Math.min(100, linear)}%` }} />}
        <div className="progress-value" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};
