import React, { forwardRef, memo, useCallback, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GanttTask } from '../types/gantt';
import { Row, visibleRows } from '../utils/flatten';
import { TaskListHeader, TaskListRow, TooltipContent, rowSchedule } from './TaskList';
import {
  COLUMN_WIDTHS,
  Timeline,
  ViewMode,
  addColumns,
  columnGroup,
  columnLabel,
  dataSpan,
  makeTimeline,
  startOfDay,
} from '../utils/timeline';
import { clipBar, DateRange } from '../utils/period';
import { missingDatesMessage } from '../utils/schedule';
import { rowHealth } from '../utils/health';
import { overrun } from '../utils/overrun';
import { DependencyLink } from '../utils/dependencies';

// The Gantt chart, in plain HTML and CSS. It holds thousands of rows, so only the rows (and
// calendar columns) on screen are rendered: one native scroll container moves everything,
// with the calendar header sticky at the top and the list of names sticky on the left.

interface Props {
  data: GanttTask[];
  viewMode: ViewMode;
  /** The period shown (bars are cut at its edges), or null for every date. */
  range: DateRange | null;
  /** The dependencies dialog: its flat rows (instead of the tree's) and the arrows between them. */
  dependencies?: { rows: Row[]; links: DependencyLink[] };
  /** Fixed room for the chart (the dialog), instead of the room left in the page. */
  height?: number;
}

export interface GanttChartHandle {
  /** Scrolls the timeline back to today. */
  scrollToToday: () => void;
}

export const ROW_HEIGHT = 40; // px
const LIST_WIDTH = 260; // px, the single Name column
const HEADER_HEIGHT = 52;
const MIN_CARD_HEIGHT = 320; // px: below that, the page scrolls instead
const OVERSCAN_ROWS = 8; // rendered above and below the visible rows
const OVERSCAN_COLUMNS = 2;

interface Viewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Hover {
  row: Row;
  x: number; // mouse position, viewport coordinates
  top: number; // bar edges, viewport coordinates
  bottom: number;
}

export const GanttChart = forwardRef<GanttChartHandle, Props>(function GanttChart({ data, viewMode, range, dependencies, height }, ref) {
  // Groups are collapsed unless expanded by the user: everything starts collapsed,
  // including groups that appear after a refresh.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const chartRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight });
  const [hover, setHover] = useState<Hover | null>(null);

  const rows = useMemo(() => dependencies?.rows ?? visibleRows(data, expanded), [dependencies, data, expanded]);
  const hasRows = rows.length > 0;

  // The timeline spans the period, or else every item (collapsed ones included, so that
  // expanding a row never moves it) with room to center today.
  const todayKey = new Date().toDateString();
  const span = useMemo(() => dataSpan(data), [data]);
  const timeline = useMemo(() => {
    if (range) return makeTimeline(range.from, range.to, viewMode);
    const today = startOfDay(new Date());
    const tomorrow = addColumns(today, 1, ViewMode.Day);
    const padding = Math.ceil(window.innerWidth / COLUMN_WIDTHS[viewMode] / 2) + 1;
    const from = span && span.from < today ? span.from : today;
    const to = span && span.to > tomorrow ? span.to : tomorrow;
    return makeTimeline(addColumns(from, -padding, viewMode), addColumns(to, padding, viewMode), viewMode);
  }, [span, range, viewMode, todayKey]);
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  const centerOnToday = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const x = timelineRef.current.x(new Date());
    element.scrollLeft = Math.max(0, Math.round(x - (element.clientWidth - LIST_WIDTH) / 2));
  }, []);
  useImperativeHandle(ref, () => ({ scrollToToday: centerOnToday }), [centerOnToday]);

  // Centers on today when the chart appears and when the view mode or the period changes; a
  // period without today (in the past or the future) is shown from its start. When only the
  // start of the timeline moves (closed items shown, filters, refresh), the dates on screen
  // stay where they are.
  const periodKey = range ? range.from.getTime() : 0;
  const shown = useRef<{ viewMode: ViewMode; periodKey: number; from: Date } | null>(null);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const previous = shown.current;
    shown.current = element ? { viewMode, periodKey, from: timeline.from } : null;
    if (!element) return;
    if (!previous || previous.viewMode !== viewMode || previous.periodKey !== periodKey) {
      const now = new Date();
      if (now >= timeline.from && now < timeline.to && (!range || (now >= range.from && now < range.to))) centerOnToday();
      else element.scrollLeft = 0;
    } else if (previous.from.getTime() !== timeline.from.getTime()) {
      element.scrollLeft += timeline.x(previous.from);
    }
  }, [timeline, viewMode, periodKey, hasRows, range, centerOnToday]);

  // What is on screen, updated once per frame while scrolling.
  const frame = useRef(0);
  const measure = useCallback(() => {
    frame.current = 0;
    const element = scrollRef.current;
    if (!element) return;
    const next = { top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight };
    setViewport((current) =>
      current.top === next.top && current.left === next.left && current.width === next.width && current.height === next.height
        ? current
        : next,
    );
  }, []);
  const onScroll = useCallback(() => {
    setHover(null);
    if (!frame.current) frame.current = requestAnimationFrame(measure);
  }, [measure]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [hasRows, measure]);

  // The card grows with its rows, down to the bottom of the page content (which stretches
  // to the window bottom, see theme.css); beyond that, the rows scroll inside it. The room
  // is measured on `.content`, not on the card, so the card's own size doesn't feed back.
  // Measured before the first paint, and never unbounded: an unbounded scroll container
  // would be as tall as every row, and every row would be rendered.
  const [maxHeight, setMaxHeight] = useState(() => window.innerHeight);
  useLayoutEffect(() => {
    if (height !== undefined) {
      setMaxHeight(height);
      return;
    }
    const card = chartRef.current;
    const content = card?.parentElement;
    if (!card || !content) return;
    const update = () => {
      const bottom = content.getBoundingClientRect().bottom - parseFloat(getComputedStyle(content).paddingBottom);
      setMaxHeight(Math.floor(Math.max(MIN_CARD_HEIGHT, bottom - card.getBoundingClientRect().top)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasRows, height]);

  const toggle = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const showTooltip = useCallback((row: Row, event: React.MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover({ row, x: event.clientX, top: box.top, bottom: box.bottom });
  }, []);
  const hideTooltip = useCallback(() => setHover(null), []);

  if (!hasRows) return null;

  // Rows and columns on screen, plus a margin. The chart is never taller than the window.
  const visibleHeight = Math.min(viewport.height, window.innerHeight);
  const firstRow = Math.max(0, Math.floor((viewport.top - HEADER_HEIGHT) / ROW_HEIGHT) - OVERSCAN_ROWS);
  const lastRow = Math.min(rows.length, Math.ceil((viewport.top + visibleHeight) / ROW_HEIGHT) + OVERSCAN_ROWS);
  const firstColumn = Math.max(0, Math.floor(viewport.left / timeline.columnWidth) - OVERSCAN_COLUMNS);
  const lastColumn = Math.min(
    timeline.columns,
    Math.ceil((viewport.left + viewport.width - LIST_WIDTH) / timeline.columnWidth) + OVERSCAN_COLUMNS,
  );
  const now = new Date();
  const todayX = now >= timeline.from && now < timeline.to ? timeline.x(now) : undefined;
  const bodyHeight = rows.length * ROW_HEIGHT;

  return (
    <div ref={chartRef} className="gantt-chart card">
      <div className="gantt-scroll" ref={scrollRef} onScroll={onScroll} style={{ maxHeight }}>
        <div className="gantt-canvas" style={{ width: LIST_WIDTH + timeline.width, height: HEADER_HEIGHT + bodyHeight }}>
          <div className="gantt-header" style={{ height: HEADER_HEIGHT }}>
            <TaskListHeader />
            <Calendar timeline={timeline} first={firstColumn} last={lastColumn} todayX={todayX} />
          </div>
          <div
            className="gantt-body"
            style={{ height: bodyHeight, ['--column-width' as string]: `${timeline.columnWidth}px` }}
          >
            {rows.slice(firstRow, lastRow).map((row, i) => (
              <ChartRow
                key={row.node.id}
                row={row}
                index={firstRow + i}
                expanded={expanded.has(row.node.id)}
                timeline={timeline}
                range={range}
                onToggle={toggle}
                onHover={showTooltip}
                onLeave={hideTooltip}
              />
            ))}
            {dependencies && (
              <DependencyLinks
                rows={rows}
                links={dependencies.links}
                timeline={timeline}
                range={range}
                first={firstRow}
                last={lastRow}
                height={bodyHeight}
              />
            )}
            {todayX !== undefined && <div className="today-line" style={{ left: LIST_WIDTH + todayX }} />}
          </div>
        </div>
      </div>
      {hover && <Tooltip hover={hover} />}
    </div>
  );
});

/** The calendar header: groups (months, or years in Month view) above the columns. */
function Calendar({ timeline, first, last, todayX }: { timeline: Timeline; first: number; last: number; todayX?: number }) {
  const { viewMode, columnWidth } = timeline;
  const columns: { index: number; start: Date }[] = [];
  for (let index = first; index < last; index++) {
    columns.push({ index, start: addColumns(timeline.from, index, viewMode) });
  }
  // Consecutive columns of the same group; the first group may start before the screen.
  const groups: { label: string; from: number; to: number }[] = [];
  for (const { index, start } of columns) {
    const label = columnGroup(start, viewMode);
    const group = groups[groups.length - 1];
    if (group?.label === label) group.to = index + 1;
    else groups.push({ label, from: index, to: index + 1 });
  }
  if (groups.length > 0) {
    const head = groups[0];
    while (head.from > 0 && columnGroup(addColumns(timeline.from, head.from - 1, viewMode), viewMode) === head.label) {
      head.from--;
    }
  }
  return (
    <div className="calendar" style={{ width: timeline.width }}>
      {groups.map((group) => (
        <div
          key={`${group.label}-${group.from}`}
          className="calendar-group"
          style={{ left: group.from * columnWidth, width: (group.to - group.from) * columnWidth }}
        >
          <span>{group.label}</span>
        </div>
      ))}
      {columns.map(({ index, start }) => (
        <div key={index} className="calendar-cell" style={{ left: index * columnWidth, width: columnWidth }}>
          {columnLabel(start, viewMode)}
        </div>
      ))}
      {todayX !== undefined && (
        <div className="today-pill" style={{ left: todayX }}>
          Today
        </div>
      )}
    </div>
  );
}

interface ChartRowProps {
  row: Row;
  index: number;
  expanded: boolean;
  timeline: Timeline;
  range: DateRange | null;
  onToggle: (id: string) => void;
  onHover: (row: Row, event: React.MouseEvent<HTMLElement>) => void;
  onLeave: () => void;
}

// Memoized: scrolling only renders the rows that come into view.
const ChartRow = memo(function ChartRow({ row, index, expanded, timeline, range, onToggle, onHover, onLeave }: ChartRowProps) {
  return (
    <div
      className="gantt-row"
      data-alt={index % 2 === 1 ? 'true' : undefined}
      data-parent-type={row.parentType}
      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
    >
      <TaskListRow row={row} expanded={expanded} onToggle={onToggle} />
      <div className="timeline-row" style={{ width: timeline.width }}>
        <Bar row={row} timeline={timeline} range={range} onHover={onHover} onLeave={onLeave} />
      </div>
    </div>
  );
});

const LABEL_CHAR_WIDTH = 7; // px, rough width of a character of the bar labels

function Bar({ row, timeline, range, onHover, onLeave }: Pick<ChartRowProps, 'row' | 'timeline' | 'range' | 'onHover' | 'onLeave'>) {
  const { node } = row;
  // Cut at the period's edges; the tooltip shows the real dates.
  const bar = clipBar(node, range);
  const left = timeline.x(bar.start);
  const width = Math.max(2, timeline.x(bar.end) - left);
  const isGroup = node.type === 'milestone' || row.hasChildren;
  const schedule = rowSchedule(row);
  const health = rowHealth(node);
  const labelInside = node.name.length * LABEL_CHAR_WIDTH + 16 < width;
  // The part planned past the parent's end, cut like the bar at the period's edges.
  const past = overrun(node, row.parent);
  const pastFrom = past ? timeline.x(past.from > bar.start ? past.from : bar.start) : 0;
  const pastWidth = past ? timeline.x(past.to < bar.end ? past.to : bar.end) - pastFrom : 0;
  return (
    <div
      className="bar"
      data-type={node.type}
      data-group={isGroup ? 'true' : undefined}
      data-schedule={schedule}
      data-closed={node.closed ? 'true' : undefined}
      data-undated={missingDatesMessage(node) ? 'true' : undefined}
      data-nested={row.depth > 0 ? 'true' : undefined}
      data-health={health}
      data-overrun={past ? 'true' : undefined}
      data-linked={row.dependency?.linked ? 'true' : undefined}
      data-external={row.dependency?.external ? 'true' : undefined}
      style={{ left, width }}
      onMouseEnter={(event) => onHover(row, event)}
      onMouseLeave={onLeave}
      onDoubleClick={() => node.webUrl && window.open(node.webUrl, '_blank', 'noopener')}
    >
      <div className="bar-track" />
      {/* Epics and milestones: where they should be today, under the real progress. */}
      {schedule && bar.linearProgress > 0 && (
        <div className="linear-progress" style={{ width: `${Math.min(100, bar.linearProgress)}%` }} />
      )}
      {!node.closed && <div className="bar-progress" style={{ width: `${bar.progress}%` }} />}
      {pastWidth > 0 && <div className="bar-overrun" style={{ left: pastFrom - left, width: pastWidth }} />}
      <span className={labelInside ? 'bar-label inside' : 'bar-label'}>{node.name}</span>
    </div>
  );
}

const ARROW_GAP = 10; // px, horizontal run out of a bar and into the next

/** The arrows of the dependencies dialog, from each blocker's end to the start of what it
 * blocks. Only the arrows crossing the rendered rows are drawn; positions come from the row
 * indexes and the timeline, not from the page. */
function DependencyLinks({
  rows,
  links,
  timeline,
  range,
  first,
  last,
  height,
}: {
  rows: Row[];
  links: DependencyLink[];
  timeline: Timeline;
  range: DateRange | null;
  first: number;
  last: number;
  height: number;
}) {
  const marker = useId().replace(/:/g, ''); // React's ":r1:" breaks url(#…) references
  const indexes = useMemo(() => new Map(rows.map((row, index) => [row.node.id, index])), [rows]);
  const paths: { key: string; d: string; conflict: boolean; markerId: string }[] = [];
  for (const link of links) {
    const from = indexes.get(link.from);
    const to = indexes.get(link.to);
    if (from === undefined || to === undefined || Math.max(from, to) < first || Math.min(from, to) >= last) continue;
    const x1 = timeline.x(clipBar(rows[from].node, range).end);
    const x2 = timeline.x(clipBar(rows[to].node, range).start);
    const y1 = from * ROW_HEIGHT + ROW_HEIGHT / 2;
    const y2 = to * ROW_HEIGHT + ROW_HEIGHT / 2;
    let d: string;
    if (x2 - x1 >= 2 * ARROW_GAP) {
      // Room between the bars: out, down (or up), in.
      const x = x1 + ARROW_GAP;
      d = `M${x1},${y1} H${x} V${y2} H${x2}`;
    } else {
      // The blocked item starts before the blocker ends: go round, along the row boundary.
      const y = (to > from ? to : from) * ROW_HEIGHT;
      d = `M${x1},${y1} h${ARROW_GAP} V${y} H${x2 - ARROW_GAP} V${y2} H${x2}`;
    }
    paths.push({ key: `${link.from} ${link.to}`, d, conflict: link.conflict, markerId: `${marker}${link.conflict ? 'c' : 'n'}` });
  }
  return (
    <svg className="dependency-links" width={timeline.width} height={height} style={{ left: LIST_WIDTH }} aria-hidden="true">
      <defs>
        {(['n', 'c'] as const).map((kind) => (
          <marker
            key={kind}
            id={`${marker}${kind}`}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
            className={kind === 'c' ? 'conflict' : undefined}
          >
            <path d="M0,0 L8,4 L0,8 z" />
          </marker>
        ))}
      </defs>
      {paths.map((path) => (
        <path
          key={path.key}
          d={path.d}
          data-conflict={path.conflict ? 'true' : undefined}
          markerEnd={`url(#${path.markerId})`}
        />
      ))}
    </svg>
  );
}

const TOOLTIP_WIDTH = 260;
const TOOLTIP_HEIGHT = 190;

function Tooltip({ hover }: { hover: Hover }) {
  const left = Math.max(8, Math.min(hover.x - 20, window.innerWidth - TOOLTIP_WIDTH - 8));
  // Below the bar, or above it near the bottom of the window.
  const below = hover.bottom + 6 + TOOLTIP_HEIGHT < window.innerHeight;
  const style: React.CSSProperties = below
    ? { left, top: hover.bottom + 6 }
    : { left, bottom: window.innerHeight - hover.top + 6 };
  return (
    <div className="gantt-tooltip-anchor" style={style}>
      <TooltipContent row={hover.row} />
    </div>
  );
}
