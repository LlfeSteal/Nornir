import React from 'react';
import { TimelineIcon, WarningIcon } from './Icons';

/** Placeholder rows shown while the chart loads for the first time. */
export const Skeleton: React.FC = () => (
  <div className="card skeleton" aria-busy="true" aria-label="Loading">
    {[0.5, 0.35, 0.6, 0.3, 0.45, 0.55, 0.4].map((width, i) => (
      <div key={i} className="skeleton-row">
        <div className="skeleton-bar" style={{ width: 160 }} />
        <div className="skeleton-bar" style={{ width: `${width * 100}%`, marginLeft: `${(i % 3) * 8}%` }} />
      </div>
    ))}
  </div>
);

export const ErrorBanner: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="banner" role="alert">
    <WarningIcon size={20} />
    <div className="banner-text">
      <strong>Couldn't load the chart</strong>
      <span>{message}</span>
    </div>
    <button type="button" className="button" onClick={onRetry}>
      Try again
    </button>
  </div>
);

export const EmptyState: React.FC<{ title?: string; message?: string; action?: React.ReactNode }> = ({
  title = 'No items in this group',
  message = 'Epics, milestones and issues of the GitLab group will show up here.',
  action,
}) => (
  <div className="card empty-state">
    <TimelineIcon size={40} />
    <strong>{title}</strong>
    {message}
    {action && <div className="empty-state-action">{action}</div>}
  </div>
);
