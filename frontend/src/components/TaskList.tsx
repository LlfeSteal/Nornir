import React, { useContext } from 'react';
import { Row } from '../utils/flatten';
import { BlockedIcon, ChevronIcon, HealthBadge, LinkIcon, WarningFillIcon } from './Icons';
import { missingDatesMessage, noChildrenMessage, rowWarnings, scheduleLabel, scheduleStatus } from '../utils/schedule';
import { parseDay } from '../utils/timeline';
import { HEALTH_LABELS, healthCountsMessage, healthMessage, rowHealth } from '../utils/health';
import { overrun, overrunMessage } from '../utils/overrun';
import { blockedMessage, blockerConflicts, conflictMessage, dependencyCount } from '../utils/dependencies';
import { DependencyContext } from './DependencyContext';
import { DependencyRef } from '../types/gantt';

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
  const blocked = blockedMessage(node);
  const dependencies = useContext(DependencyContext);
  const count = dependencies ? dependencyCount(dependencies.index, node) : 0;
  const countLabel = `View ${count} ${count === 1 ? 'dependency' : 'dependencies'}`;
  const linked = row.dependency?.linked;
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
      data-blocked={blocked ? 'true' : undefined}
      data-linked={linked ? 'true' : undefined}
      data-external={row.dependency?.external ? 'true' : undefined}
      data-critical={row.dependency?.critical ? 'true' : undefined}
      data-context={row.dependency?.context ? 'true' : undefined}
    >
      <div className="task-list-cell" title={node.name}>
        {row.guides.map((line, level) => (
          <span key={level} className={line ? 'tree-guide line' : 'tree-guide'} />
        ))}
        {depth > 0 && <span className={row.isLast ? 'tree-branch last' : 'tree-branch'} />}
        {/* Milestones are groups even when empty; only items with children can open (not in the
            dependencies dialog, fully expanded). */}
        {row.hasChildren && !row.dependency ? (
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
        {linked ? (
          // An item linked from elsewhere: where it sits, under its name.
          <div className="task-list-name">
            {node.name}
            <span className="task-list-detail">{dependencyPlace(row)}</span>
          </div>
        ) : (
          <div className="task-list-name">{node.name}</div>
        )}
        {/* Trailing accessories, like a macOS / iOS table cell: aligned from row to row. */}
        {(warnings.length > 0 || health || blocked || count > 0) && (
          <span className="row-accessories">
            {blocked && (
              <span className="row-blocked" role="img" aria-label={blocked} title={blocked}>
                <BlockedIcon size={15} />
              </span>
            )}
            {/* One triangle for every warning, one line each in its help tag. */}
            {warnings.length > 0 && (
              <span className="row-warning" role="img" aria-label={warnings.join('. ')} title={warnings.join('\n')}>
                <WarningFillIcon />
              </span>
            )}
            {health && <HealthBadge level={health} label={healthMessage(node)} />}
            {count > 0 && (
              <button
                type="button"
                className="row-dependencies"
                aria-label={countLabel}
                title={countLabel}
                onClick={() => dependencies?.open(node)}
              >
                <LinkIcon size={12} />
                {count}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
};

/** Where a row of the dependencies dialog linked from elsewhere sits. */
function dependencyPlace(row: Row): string {
  if (row.dependency?.external) return 'Outside the group';
  return row.dependency?.path ? `In ${row.dependency.path}` : 'Top level';
}

/** "A, B (closed) and 2 more". */
function refNames(refs: DependencyRef[], max = 3): string {
  const shown = refs.slice(0, max).map((ref) => (ref.closed ? `${ref.name} (closed)` : ref.name));
  return refs.length > max ? `${shown.join(', ')} and ${refs.length - max} more` : shown.join(', ');
}

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
      {row.dependency?.linked && <p className="dependency-place">{dependencyPlace(row)}</p>}
      {row.dependency?.critical && <p className="critical-note">On the critical path</p>}
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
      {blockerConflicts(node).map((conflict) => (
        <p key={conflict.blocker.id} className="conflict-note">
          <strong>{conflictMessage(conflict)}</strong>
        </p>
      ))}
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
      {node.blockedBy && node.blockedBy.length > 0 && (
        <p className="dependency-note" data-blocked={blockedMessage(node) ? 'true' : undefined}>
          Blocked by <strong>{refNames(node.blockedBy)}</strong>
        </p>
      )}
      {node.blocking && node.blocking.length > 0 && (
        <p className="dependency-note">
          Blocks <strong>{refNames(node.blocking)}</strong>
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
