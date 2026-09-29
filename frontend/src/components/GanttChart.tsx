import React, { forwardRef, memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

// The Gantt chart, in plain HTML and CSS. It holds thousands of rows, so only the rows (and
// calendar columns) on screen are rendered: one native scroll container moves everything,
// with the calendar header sticky at the top and the list of names sticky on the left.

interface Props {
  data: GanttTask[];
  viewMode: ViewMode;
  /** The period shown (bars are cut at its edges), or null for every date. */
  range: DateRange | null;
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

export const GanttChart = forwardRef<GanttChartHandle, Props>(function GanttChart({ data, viewMode, range }, ref) {
  // Groups are collapsed unless expanded by the user: everything starts collapsed,
  // including groups that appear after a refresh.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const chartRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight });
  const [hover, setHover] = useState<Hover | null>(null);

  const rows = useMemo(() => visibleRows(data, expanded), [data, expanded]);
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
  }, [hasRows]);

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
  const labelInside = node.name.length * LABEL_CHAR_WIDTH + 16 < width;
  return (
    <div
      className="bar"
      data-type={node.type}
      data-group={isGroup ? 'true' : undefined}
      data-schedule={schedule}
      data-closed={node.closed ? 'true' : undefined}
      data-undated={missingDatesMessage(node) ? 'true' : undefined}
      data-nested={row.depth > 0 ? 'true' : undefined}
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
      <span className={labelInside ? 'bar-label inside' : 'bar-label'}>{node.name}</span>
    </div>
  );
}

const TOOLTIP_WIDTH = 260;
const TOOLTIP_HEIGHT = 150;

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
