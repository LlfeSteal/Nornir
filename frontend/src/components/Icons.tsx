import React from 'react';

// Inline SVG icons in the spirit of SF Symbols: 1.8 px strokes, rounded caps.

type IconProps = { size?: number; className?: string };

function Icon({ size = 16, className, strokeWidth = 1.8, children }: IconProps & { strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ChevronIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </Icon>
);

export const TodayIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
    <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
  </Icon>
);

export const WarningIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5L2.5 20h19L12 3.5z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Icon>
);

export const TimelineIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h9M7 12h11M5 18h7" strokeWidth={2.4} />
  </Icon>
);

export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Icon>
);

/** Half-filled circle, like SF Symbols' circle.lefthalf.filled (Automatic appearance). */
export const AutoAppearanceIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth={2.2} />
  </Icon>
);

export const ClosedIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.3l2.4 2.4 4.6-5" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L20 20" />
  </Icon>
);

/** Filled circle with a cross, like SF Symbols' xmark.circle.fill (clears a field). */
export const ClearIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
    <path d="M9 9l6 6M15 9l-6 6" stroke="var(--card)" strokeWidth={2} />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 10l5 5 5-5" strokeWidth={2} />
  </Icon>
);

/** Filled warning sign, like SF Symbols' exclamationmark.triangle.fill: the row warnings,
 * drawn like the health icons so the trailing accessories of a row match. */
export const WarningFillIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M10.3 3.6a2 2 0 0 1 3.4 0l8.1 14.1a2 2 0 0 1-1.7 3H3.9a2 2 0 0 1-1.7-3z"
      fill="currentColor"
    />
    <path d="M12 9v4.6" stroke="#fff" strokeWidth={2.3} strokeLinecap="round" />
    <circle cx="12" cy="17.2" r="1.3" fill="#fff" />
  </svg>
);

/** Health status, like SF Symbols: exclamationmark.octagon.fill (at risk) and
 * exclamationmark.circle.fill (needs attention). The shape tells them apart without color;
 * the help tag says whether the status is the item's own or comes from below. */
export const HealthBadge: React.FC<{ level: 'atRisk' | 'needsAttention'; label?: string; size?: number }> = ({
  level,
  label,
  size = 15,
}) => (
  <span
    className="health"
    data-level={level}
    // Without a label (e.g. in the legend, next to its text), the icon is decorative.
    {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
  >
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {level === 'atRisk' ? (
        <path
          className="health-shape"
          d="M8.4 2.6h7.2l5.8 5.8v7.2l-5.8 5.8H8.4l-5.8-5.8V8.4z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      ) : (
        <circle className="health-shape" cx="12" cy="12" r="10" fill="currentColor" />
      )}
      <path d="M12 7.2v5.6" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="1.4" fill="#fff" />
    </svg>
  </span>
);

/** Circle with a slash, like SF Symbols' nosign: an item with an open blocker. Stroked, so it
 * doesn't read as the filled red octagon of the "at risk" health status. */
export const BlockedIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2.2}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 6l12 12" />
  </Icon>
);

/** Two chain links, like SF Symbols' link: the dependencies of a row. */
export const LinkIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4l-1.4 1.4" />
    <path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4" />
  </Icon>
);

/** Like SF Symbols' star / star.fill: the default portfolio. */
export const StarIcon = ({ filled, ...props }: IconProps & { filled?: boolean }) => (
  <Icon {...props}>
    <path
      d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Icon>
);

/** Like SF Symbols' pencil: renames in place. */
export const PencilIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15.5 5.5l3 3L8 19l-4 1 1-4z" />
    <path d="M13.5 7.5l3 3" />
  </Icon>
);

/** Like SF Symbols' trash: deletes. */
export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2" />
    <path d="M6.5 6.5l1 13h9l1-13" />
    <path d="M10.5 10v6.5M13.5 10v6.5" />
  </Icon>
);
