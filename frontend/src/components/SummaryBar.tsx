import React from 'react';
import { AttentionFlag, AttentionIndex } from '../utils/attention';
import { Filters } from '../utils/filters';
import { BlockedIcon, HealthBadge, WarningFillIcon } from './Icons';

interface Chip {
  flag: AttentionFlag;
  label: (count: number) => string;
  mark: React.ReactNode;
}

const dot = (color: string) => <span className="legend-dot" style={{ background: color }} />;
const hatch = <span className="legend-swatch overrun summary-hatch" />;

const CHIPS: Chip[] = [
  { flag: 'late', label: () => 'late', mark: dot('var(--late)') },
  { flag: 'behind', label: () => 'behind', mark: dot('var(--at-risk)') },
  { flag: 'atRisk', label: () => 'at risk', mark: <HealthBadge level="atRisk" size={12} /> },
  { flag: 'needsAttention', label: (n) => (n === 1 ? 'needs attention' : 'need attention'), mark: <HealthBadge level="needsAttention" size={12} /> },
  { flag: 'blocked', label: () => 'blocked', mark: <span className="row-blocked"><BlockedIcon size={12} /></span> },
  { flag: 'conflict', label: () => 'before a blocker ends', mark: hatch },
  { flag: 'pastParent', label: () => 'past their parent', mark: hatch },
  { flag: 'noDates', label: () => 'without dates', mark: <span className="row-warning"><WarningFillIcon size={12} /></span> },
  { flag: 'noChildren', label: () => 'without children', mark: <span className="row-warning"><WarningFillIcon size={12} /></span> },
];

interface Props {
  index: AttentionIndex;
  filters: Filters;
  onChange: (filters: Filters) => void;
}

/** What needs attention among the items in view (the period and the portfolio), each item
 * counted once: one chip per kind, pressing it lists those items. "Blocked" is the filter
 * bar's Blocked button; the others are attention flags, ORed together. */
export const SummaryBar: React.FC<Props> = ({ index, filters, onChange }) => {
  const chips = CHIPS.map((chip) => ({ ...chip, count: index.get(chip.flag)?.size ?? 0 })).filter((chip) => chip.count > 0);
  const pressed = (flag: AttentionFlag) => (flag === 'blocked' ? filters.blocked : filters.attention.includes(flag));
  const toggle = (flag: AttentionFlag) => {
    if (flag === 'blocked') onChange({ ...filters, blocked: !filters.blocked });
    else {
      const attention = filters.attention.includes(flag) ? filters.attention.filter((f) => f !== flag) : [...filters.attention, flag];
      onChange({ ...filters, attention });
    }
  };

  return (
    <div className="summary-bar" role="group" aria-label="Attention summary">
      {chips.length === 0 && <span className="summary-empty">Nothing needs attention</span>}
      {chips.map(({ flag, label, mark, count }) => (
        <button
          key={flag}
          type="button"
          className="summary-chip"
          data-flag={flag}
          aria-pressed={pressed(flag)}
          aria-label={`${count} ${label(count)}`}
          onClick={() => toggle(flag)}
        >
          {mark}
          <span className="summary-count">{count}</span>
          {label(count)}
        </button>
      ))}
    </div>
  );
};
