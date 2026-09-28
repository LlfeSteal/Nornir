import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { GanttTask } from '../types/gantt';
import { FlatGanttTask, flattenGanttTree, visibleRows } from '../utils/flatten';
import { RowInfoContext, TaskListHeader, TaskListTable, TooltipContent } from './TaskList';
import { columnFraction, columnsBetween } from '../utils/today';
import { groupBand, muted, PALETTES } from '../utils/colors';
import { useColorScheme } from '../utils/appearance';
import { scheduleStatus } from '../utils/schedule';

interface Props {
  data: GanttTask[];
  viewMode: ViewMode;
}

export interface GanttChartHandle {
  /** Scrolls the timeline back to today. */
  scrollToToday: () => void;
}

const ROW_HEIGHT = 40; // px

const LIST_WIDTH = 260; // px, the single Name column
const HEADER_HEIGHT = 52;
const MIN_CARD_HEIGHT = 320; // px: below that, the page scrolls instead
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";

const COLUMN_WIDTHS: Partial<Record<ViewMode, number>> = {
  [ViewMode.Day]: 44,
  [ViewMode.Week]: 110,
  [ViewMode.Month]: 180,
};

// gantt-task-react can only fill today's whole column (a whole week in Week view), so the
// line is drawn by hand: we find the column it highlights (`g.today rect`, made transparent
// through todayColor) and put a line at today's position inside that column. The library
// re-renders its SVG on its own (scrolling, expanding rows...), hence the MutationObserver.
function drawTodayLine(root: HTMLElement, viewMode: ViewMode) {
  const column = root.querySelector<SVGRectElement>('g.today rect');
  const svg = column?.ownerSVGElement;
  let line = root.querySelector<SVGLineElement>('line.today-line');
  if (!column || !svg || !column.getAttribute('width')) {
    line?.remove();
    return;
  }
  if (!line || line.ownerSVGElement !== svg) {
    line?.remove();
    line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'today-line');
    svg.appendChild(line); // last child: drawn above the bars
  }
  const x = String(
    Number(column.getAttribute('x')) + columnFraction(new Date(), viewMode) * Number(column.getAttribute('width')),
  );
  const attributes: Record<string, string> = { x1: x, x2: x, y1: '0', y2: column.getAttribute('height') ?? '0' };
  setAttributes(line, attributes);
  drawTodayPill(root, Number(x));
}

// Only writes changes, so our own writes don't keep triggering the MutationObserver.
function setAttributes(element: Element, attributes: Record<string, string>) {
  for (const [name, value] of Object.entries(attributes)) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
}

// A "Today" pill at the bottom of the calendar header, above the line. The header is a
// separate SVG (the one holding the calendar background) that scrolls with the chart.
function drawTodayPill(root: HTMLElement, x: number) {
  const header = root.querySelector<SVGRectElement>('._35nLX')?.ownerSVGElement;
  if (!header) return;
  let pill = header.querySelector<SVGGElement>('g.today-pill');
  if (!pill) {
    pill = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pill.setAttribute('class', 'today-pill');
    pill.append(
      document.createElementNS('http://www.w3.org/2000/svg', 'rect'),
      document.createElementNS('http://www.w3.org/2000/svg', 'text'),
    );
    pill.lastElementChild!.textContent = 'Today';
    header.appendChild(pill);
  }
  const width = 40;
  const height = 16;
  const y = HEADER_HEIGHT - height - 2;
  setAttributes(pill.firstElementChild!, {
    x: String(x - width / 2),
    y: String(y),
    width: String(width),
    height: String(height),
    rx: String(height / 2),
  });
  setAttributes(pill.lastElementChild!, { x: String(x), y: String(y + height / 2) });
}

// Scrolls the chart so that the today line is in the middle of the visible area. The
// library's `viewDate` prop can't do it reliably: it resolves the date against stale
// columns when the date range changes in the same render (first render, collapsed rows).
// So we drive the library's own horizontal scrollbar, which it listens to via onScroll.
function scrollParts(root: HTMLElement) {
  const line = root.querySelector<SVGLineElement>('line.today-line');
  // The library's scrollbar is the only horizontally scrollable element; the chart itself
  // sits in an overflow-hidden container the library scrolls to match it.
  const scrollbar = [...root.querySelectorAll<HTMLElement>('div')].find((div) =>
    ['auto', 'scroll'].includes(getComputedStyle(div).overflowX),
  );
  const container = line?.ownerSVGElement?.parentElement?.parentElement;
  return line && scrollbar && container ? { line, scrollbar, container } : null;
}

/** Scrolls so that the today line sits `offset` px from the left of the visible area
 * (the middle when no offset is given). */
function keepTodayLineAt(root: HTMLElement, offset?: number) {
  const parts = scrollParts(root);
  if (!parts) return;
  const { line, scrollbar, container } = parts;
  const want = offset ?? container.clientWidth / 2;
  const target = Math.max(0, Math.round(Number(line.getAttribute('x1')) - want));
  if (Math.abs(scrollbar.scrollLeft - target) > 1) {
    scrollbar.scrollLeft = target;
  } else if (Math.abs(container.scrollLeft - scrollbar.scrollLeft) > 1) {
    // The library ignores every other scroll event: send it again until the chart follows.
    scrollbar.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
}

// Tints the timeline rows that sit inside an expanded group, like the list rows. The
// library draws one `g.rows rect` per task, hidden ones included, at y = index × rowHeight:
// the visible row at index i lines up with the rect at that y.
function paintGroupBands(root: HTMLElement, rows: FlatGanttTask[]) {
  root.querySelectorAll<SVGRectElement>('g.rows rect').forEach((rect) => {
    const row = rows[Math.round(Number(rect.getAttribute('y')) / ROW_HEIGHT)];
    const fill = row?.parentType ? groupBand(row.parentType) : '';
    if (rect.style.fill !== fill) rect.style.fill = fill;
  });
}

// Epics and milestones get a third layer between their transparent track and their solid
// progress: the linear progress, i.e. where they should be today if the work advanced evenly
// (computed by the backend). The library can't draw it, so it is added next to the track
// (`._2RbVy`, first rect of a project bar `._1KJ6x`), before the progress rect so the solid
// progress stays on top. Bars sit in their row: row index = floor(y / ROW_HEIGHT).
function paintLinearProgress(root: HTMLElement, rows: FlatGanttTask[]) {
  root.querySelectorAll<SVGRectElement>('._1KJ6x > rect._2RbVy').forEach((track) => {
    const row = rows[Math.floor(Number(track.getAttribute('y')) / ROW_HEIGHT)];
    let linear = track.parentElement!.querySelector<SVGRectElement>('rect.linear-progress');
    if (!row || row.closed || !(row.linearProgress > 0)) {
      linear?.remove();
      return;
    }
    if (!linear) {
      linear = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      linear.setAttribute('class', 'linear-progress');
      track.after(linear);
    }
    const width = Number(track.getAttribute('width')) * Math.min(100, row.linearProgress) / 100;
    setAttributes(linear, {
      x: track.getAttribute('x') ?? '0',
      y: track.getAttribute('y') ?? '0',
      height: track.getAttribute('height') ?? '0',
      rx: track.getAttribute('rx') ?? '0',
      ry: track.getAttribute('ry') ?? '0',
      width: String(width),
      fill: track.getAttribute('fill') ?? 'currentColor',
    });
  });
}

// Closed rows are drawn with a gray hatch, an SVG pattern defined once in the page (see
// ClosedHatchPattern); bar colors are props, so the pattern is referenced by URL.
const CLOSED_HATCH_ID = 'nornir-closed-hatch';
const CLOSED_FILL = `url(#${CLOSED_HATCH_ID})`;

function ClosedHatchPattern() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <pattern id={CLOSED_HATCH_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" style={{ fill: 'var(--closed-bg)' }} />
          <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--closed-stroke)', strokeWidth: 2.5 }} />
        </pattern>
      </defs>
    </svg>
  );
}

// Flags the bars of closed rows (data-closed on the library's task group, which also holds
// the label), so the CSS can gray their label and keep the hatch readable.
function markClosedBars(root: HTMLElement, rows: FlatGanttTask[]) {
  root.querySelectorAll<SVGGElement>('._KxSXS, ._1KJ6x').forEach((bar) => {
    const rect = bar.querySelector('rect');
    const row = rect ? rows[Math.floor(Number(rect.getAttribute('y')) / ROW_HEIGHT)] : undefined;
    const item = bar.parentElement!;
    if (row?.closed) {
      if (item.getAttribute('data-closed') !== 'true') item.setAttribute('data-closed', 'true');
    } else if (item.hasAttribute('data-closed')) {
      item.removeAttribute('data-closed');
    }
  });
}

const CENTERING_MS = 500;

/** Keeps the today line at `offset` (see keepTodayLineAt) for a short while, as the library
 * settles over a few renders. Returns a function that stops it. */
function startKeepingTodayLine(root: HTMLElement, offset: number | undefined, onEnd: () => void): () => void {
  let frame = requestAnimationFrame(function step() {
    keepTodayLineAt(root, offset);
    frame = requestAnimationFrame(step);
  });
  const stop = setTimeout(() => {
    cancelAnimationFrame(frame);
    onEnd();
  }, CENTERING_MS);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(stop);
    onEnd();
  };
}

// "YYYY-MM-DD" → local midnight (new Date("YYYY-MM-DD") would be parsed as UTC).
function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const GanttChart = forwardRef<GanttChartHandle, Props>(function GanttChart({ data, viewMode }, ref) {
  const scheme = useColorScheme();
  // Groups are collapsed unless expanded by the user: everything starts collapsed,
  // including groups that appear after a refresh.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const chartRef = useRef<HTMLDivElement>(null);
  const columnWidth = COLUMN_WIDTHS[viewMode] ?? 120;
  // The chart element only exists when there is something to show.
  const hasTasks = data.length > 0;

  // One scroll loop at a time: centering on today, or keeping the view in place.
  const scrollLoop = useRef<{ stop: () => void } | null>(null);
  const keepTodayLine = useCallback((offset?: number) => {
    scrollLoop.current?.stop();
    const element = chartRef.current;
    if (!element) return;
    const loop = {
      stop: startKeepingTodayLine(element, offset, () => {
        if (scrollLoop.current === loop) scrollLoop.current = null;
      }),
    };
    scrollLoop.current = loop;
  }, []);
  useEffect(() => () => scrollLoop.current?.stop(), []);

  // Centers on today when the chart appears and when the view mode changes.
  useEffect(() => {
    keepTodayLine();
  }, [viewMode, hasTasks, keepTodayLine]);

  const scrollToToday = useCallback(() => keepTodayLine(), [keepTodayLine]);
  useImperativeHandle(ref, () => ({ scrollToToday }), [scrollToToday]);

  // Where the today line was last drawn, to notice when the date range changes.
  const lastLine = useRef<{ x: number; viewMode: ViewMode } | null>(null);

  const { tasks, urls, rowInfo, shownRows } = useMemo(() => {
    const flatItems = flattenGanttTree(data);
    const urls = new Map<string, string>();
    const rowInfo = new Map(flatItems.map((item) => [item.id, item]));
    const tasks: Task[] = flatItems.map((item) => {
      if (item.webUrl) urls.set(item.id, item.webUrl);
      // Children are drawn toned down compared to the top-level bars they belong to.
      const palette = PALETTES[scheme];
      const shade = (color: string) => (item.depth > 0 ? muted(color, scheme) : color);
      // Any item with children becomes a collapsible "project".
      const isGroup = item.type === 'milestone' || item.hasChildren;
      // Epics and milestones are colored by schedule status (green / orange / red), other
      // rows by type.
      const color = shade(
        isGroup ? palette.status[scheduleStatus(item.progress, item.linearProgress)] : palette.types[item.type],
      );
      return {
        start: parseDay(item.start),
        end: parseDay(item.end),
        name: item.name,
        id: item.id,
        type: isGroup ? 'project' : 'task',
        // A closed row is drawn as one full hatched bar; its real progress stays in the
        // tooltip (read from RowInfoContext).
        progress: item.closed ? 100 : item.progress || 0,
        project: item.parent,
        hideChildren: isGroup ? !expanded.has(item.id) : undefined,
        styles: item.closed
          ? { backgroundColor: CLOSED_FILL, backgroundSelectedColor: CLOSED_FILL, progressColor: CLOSED_FILL, progressSelectedColor: CLOSED_FILL }
          : isGroup
          ? // Groups: a tinted track (see theme.css) with the solid progress on top.
            { backgroundColor: color, backgroundSelectedColor: color, progressColor: color, progressSelectedColor: color }
          : {
              backgroundColor: color,
              backgroundSelectedColor: shade(palette.selected),
              progressColor: '#00000033',
              progressSelectedColor: '#00000055',
            },
      };
    });
    return { tasks, urls, rowInfo, shownRows: visibleRows(flatItems, expanded) };
  }, [data, expanded, scheme]);

  // The card grows with its rows, up to the bottom of the page content (which stretches to
  // the window bottom, see theme.css); beyond that, the rows scroll inside it. The space is
  // measured from `.content`, not from the card, so the card's own size doesn't feed back.
  const [maxBodyHeight, setMaxBodyHeight] = useState(0);
  useEffect(() => {
    const element = chartRef.current;
    const content = element?.parentElement;
    if (!element || !content) return;
    const measure = () => {
      const bottom = content.getBoundingClientRect().bottom - parseFloat(getComputedStyle(content).paddingBottom);
      const card = Math.max(MIN_CARD_HEIGHT, bottom - element.getBoundingClientRect().top);
      const scrollbar = element.querySelector<HTMLElement>('._2k9Ys')?.offsetHeight ?? 12;
      setMaxBodyHeight(Math.floor(card - HEADER_HEIGHT - scrollbar));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasTasks]);
  // Never taller than the rows: with more room than rows, the library scrolls to a negative
  // offset on the wheel or ↑/↓ (which shifts its tooltip). 0 (auto) until measured.
  const ganttHeight = maxBodyHeight > 0 ? Math.min(maxBodyHeight, shownRows.length * ROW_HEIGHT) : 0;

  // Draws the today line and the group bands whenever the library re-renders its SVG.
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const draw = () => {
      const before = scrollParts(element);
      const previousX = before ? Number(before.line.getAttribute('x1')) : undefined;
      drawTodayLine(element, viewMode);
      const after = scrollParts(element);
      if (after) {
        const x = Number(after.line.getAttribute('x1'));
        // The library keeps its scroll in pixels: when its date range changes (rows shown or
        // hidden, closed items toggled, refresh), the dates under the user's eye would shift.
        // Keep the today line where it was on screen instead.
        if (
          previousX !== undefined &&
          x !== previousX &&
          lastLine.current?.viewMode === viewMode &&
          !scrollLoop.current
        ) {
          keepTodayLine(previousX - after.container.scrollLeft);
        }
        lastLine.current = { x, viewMode };
      }
      paintGroupBands(element, shownRows);
      paintLinearProgress(element, shownRows);
      markClosedBars(element, shownRows);
    };
    draw();
    const observer = new MutationObserver(draw);
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['x', 'y', 'width', 'height', 'fill'] });
    return () => observer.disconnect();
  }, [viewMode, hasTasks, shownRows, keepTodayLine]);

  // The date range starts preStepsCount columns before the earliest visible item: make it
  // start early enough to show today in the middle of the screen, even when every item is
  // in the future.
  const todayKey = new Date().toDateString();
  const preStepsCount = useMemo(() => {
    const halfScreen = Math.ceil(window.innerWidth / columnWidth / 2);
    const latestStart = tasks.reduce((latest, t) => (t.start > latest ? t.start : latest), new Date(0));
    return halfScreen + columnsBetween(new Date(), latestStart, viewMode) + 1;
  }, [tasks, todayKey, viewMode, columnWidth]);

  const toggle = (task: Task) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  };

  const openInGitLab = (task: Task) => {
    const url = urls.get(task.id);
    if (url) window.open(url, '_blank', 'noopener');
  };

  if (tasks.length === 0) return null;

  return (
    <div ref={chartRef} className="gantt-chart card">
      <ClosedHatchPattern />
      <RowInfoContext.Provider value={rowInfo}>
        <Gantt
          tasks={tasks}
          viewMode={viewMode}
          preStepsCount={preStepsCount}
          todayColor="transparent"
          listCellWidth={`${LIST_WIDTH}px`}
          rowHeight={ROW_HEIGHT}
          headerHeight={HEADER_HEIGHT}
          ganttHeight={ganttHeight}
          barCornerRadius={6}
          barFill={60}
          fontFamily={FONT}
          fontSize="12px"
          TaskListHeader={TaskListHeader}
          TaskListTable={TaskListTable}
          TooltipContent={TooltipContent}
          columnWidth={columnWidth}
          onExpanderClick={toggle}
          onDoubleClick={openInGitLab}
        />
      </RowInfoContext.Provider>
    </div>
  );
});
