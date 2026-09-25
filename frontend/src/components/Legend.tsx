import React from 'react';

const ITEMS = [
  { label: 'Milestone', color: 'var(--milestone)' },
  { label: 'Epic', color: 'var(--epic)' },
  { label: 'Issue', color: 'var(--issue)' },
];

export const Legend: React.FC = () => (
  <div className="legend" aria-label="Legend">
    {ITEMS.map((item) => (
      <span key={item.label} className="legend-item">
        <span className="legend-dot" style={{ background: item.color }} />
        {item.label}
      </span>
    ))}
    <span className="legend-item">
      <span className="legend-line" />
      Today
    </span>
  </div>
);
