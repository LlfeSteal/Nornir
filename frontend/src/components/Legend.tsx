import React from 'react';

const TYPES = [
  { label: 'Milestone', color: 'var(--milestone)' },
  { label: 'Epic', color: 'var(--epic)' },
  { label: 'Issue', color: 'var(--issue)' },
];

// Colors of epic and milestone bars, see utils/schedule.ts.
const STATUSES = [
  { label: 'On track', color: 'var(--on-track)' },
  { label: 'Up to 5% behind', color: 'var(--at-risk)' },
  { label: 'More than 5% behind', color: 'var(--late)' },
];

export const Legend: React.FC = () => (
  <div className="legend" aria-label="Legend">
    <span className="legend-group">
      {TYPES.map((item) => (
        <span key={item.label} className="legend-item">
          <span className="legend-dot" style={{ background: item.color, borderRadius: '50%' }} />
          {item.label}
        </span>
      ))}
    </span>
    <span className="legend-group">
      {STATUSES.map((item) => (
        <span key={item.label} className="legend-item">
          <span className="legend-dot" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </span>
    <span className="legend-group">
      <span className="legend-item legend-progress">
        <span className="legend-swatch solid" />
        Progress
        <span className="legend-swatch linear" />
        Expected
        <span className="legend-swatch track" />
        Planned
      </span>
      <span className="legend-item">
        <span className="legend-line" />
        Today
      </span>
    </span>
  </div>
);
