import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { GanttTask } from '../types/gantt';
import { FlatGanttTask, flattenGanttTree, visibleRows } from '../utils/flatten';
import { RowInfoContext, TaskListHeader, TaskListTable, TooltipContent } from './TaskList';
import { columnFraction, columnsBetween } from '../utils/today';
import { groupBand, muted, PALETTES, useColorScheme } from '../utils/colors';

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
function centerOnTodayLine(root: HTMLElement) {
  const line = root.querySelector<SVGLineElement>('line.today-line');
  // The library's scrollbar is the only horizontally scrollable element; the chart itself
  // sits in an overflow-hidden container the library scrolls to match it.
  const scrollbar = [...root.querySelectorAll<HTMLElement>('div')].find((div) =>
    ['auto', 'scroll'].includes(getComputedStyle(div).overflowX),
  );
  const container = line?.ownerSVGElement?.parentElement?.parentElement;
  if (!line || !scrollbar || !container) return;
  const target = Math.max(0, Math.round(Number(line.getAttribute('x1')) - container.clientWidth / 2));
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

const CENTERING_MS = 500;

/** Keeps centering on today for a short while, as the library settles over a few renders.
 * Returns a function that stops it. */
function startCentering(root: HTMLElement): () => void {
  let frame = requestAnimationFrame(function step() {
    centerOnTodayLine(root);
    frame = requestAnimationFrame(step);
  });
  const stop = setTimeout(() => cancelAnimationFrame(frame), CENTERING_MS);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(stop);
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

  // Centers on today when the chart appears and when the view mode changes. The library
  // settles over a few renders, so keep centering for a short while.
  useEffect(() => {
    const element = chartRef.current;
    return element ? startCentering(element) : undefined;
  }, [viewMode, hasTasks]);

  const stopManualCentering = useRef<() => void>();
  const scrollToToday = useCallback(() => {
    stopManualCentering.current?.();
    if (chartRef.current) stopManualCentering.current = startCentering(chartRef.current);
  }, []);
  useImperativeHandle(ref, () => ({ scrollToToday }), [scrollToToday]);
  useEffect(() => () => stopManualCentering.current?.(), []);

  const { tasks, urls, rowInfo, shownRows } = useMemo(() => {
    const flatItems = flattenGanttTree(data);
    const urls = new Map<string, string>();
    const rowInfo = new Map(flatItems.map((item) => [item.id, item]));
    const tasks: Task[] = flatItems.map((item) => {
      if (item.webUrl) urls.set(item.id, item.webUrl);
      // Children are drawn toned down compared to the top-level bars they belong to.
      const palette = PALETTES[scheme];
      const shade = (color: string) => (item.depth > 0 ? muted(color, scheme) : color);
      const color = shade(palette.types[item.type]);
      // Any item with children becomes a collapsible "project".
      const isGroup = item.type === 'milestone' || item.hasChildren;
      return {
        start: parseDay(item.start),
        end: parseDay(item.end),
        name: item.name,
        id: item.id,
        type: isGroup ? 'project' : 'task',
        progress: item.progress || 0,
        project: item.parent,
        hideChildren: isGroup ? !expanded.has(item.id) : undefined,
        styles: isGroup
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

  // Draws the today line and the group bands whenever the library re-renders its SVG.
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const draw = () => {
      drawTodayLine(element, viewMode);
      paintGroupBands(element, shownRows);
    };
    draw();
    const observer = new MutationObserver(draw);
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['x', 'y', 'width', 'height'] });
    return () => observer.disconnect();
  }, [viewMode, hasTasks, shownRows]);

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
      <RowInfoContext.Provider value={rowInfo}>
        <Gantt
          tasks={tasks}
          viewMode={viewMode}
          preStepsCount={preStepsCount}
          todayColor="transparent"
          listCellWidth={`${LIST_WIDTH}px`}
          rowHeight={ROW_HEIGHT}
          headerHeight={HEADER_HEIGHT}
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
