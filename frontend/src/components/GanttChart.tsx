import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { GanttTask } from '../types/gantt';
import { FlatGanttTask, flattenGanttTree, visibleRows } from '../utils/flatten';
import { RowInfoContext, TaskListHeader, TaskListTable, TooltipContent } from './TaskList';
import { columnFraction, columnsBetween } from '../utils/today';
import { groupBand, lighten, TYPE_COLORS } from '../utils/colors';

interface Props {
  data: GanttTask[];
}

const ROW_HEIGHT = 50; // px, gantt-task-react's default rowHeight
const CHILD_BAR_LIGHTEN = 0.35; // bars below the top level are drawn lighter

const VIEW_MODES: { label: string; mode: ViewMode }[] = [
  { label: 'Day', mode: ViewMode.Day },
  { label: 'Week', mode: ViewMode.Week },
  { label: 'Month', mode: ViewMode.Month },
];

const LIST_WIDTH = 220; // px, the single Name column

const COLUMN_WIDTHS: Partial<Record<ViewMode, number>> = {
  [ViewMode.Day]: 50,
  [ViewMode.Week]: 120,
  [ViewMode.Month]: 200,
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
  for (const [name, value] of Object.entries(attributes)) {
    // Only write changes, so our own writes don't keep triggering the observer.
    if (line.getAttribute(name) !== value) line.setAttribute(name, value);
  }
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

// "YYYY-MM-DD" → local midnight (new Date("YYYY-MM-DD") would be parsed as UTC).
function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const GanttChart: React.FC<Props> = ({ data }) => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
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
    if (!element) return;
    let frame = requestAnimationFrame(function step() {
      centerOnTodayLine(element);
      frame = requestAnimationFrame(step);
    });
    const stop = setTimeout(() => cancelAnimationFrame(frame), CENTERING_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(stop);
    };
  }, [viewMode, hasTasks]);

  const { tasks, urls, rowInfo, shownRows } = useMemo(() => {
    const flatItems = flattenGanttTree(data);
    const urls = new Map<string, string>();
    const rowInfo = new Map(flatItems.map((item) => [item.id, item]));
    const tasks: Task[] = flatItems.map((item) => {
      if (item.webUrl) urls.set(item.id, item.webUrl);
      // Children are drawn lighter than the top-level bars they belong to.
      const shade = (color: string) => (item.depth > 0 ? lighten(color, CHILD_BAR_LIGHTEN) : color);
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
        styles: {
          backgroundColor: shade(TYPE_COLORS[item.type]),
          backgroundSelectedColor: shade('#2b6cb0'),
          progressColor: '#1a202c55',
          progressSelectedColor: '#1a202c88',
        },
      };
    });
    return { tasks, urls, rowInfo, shownRows: visibleRows(flatItems, expanded) };
  }, [data, expanded]);

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

  if (tasks.length === 0) return <p className="empty">No data to display.</p>;

  return (
    <div className="gantt">
      <div className="toolbar">
        {VIEW_MODES.map(({ label, mode }) => (
          <button
            key={mode}
            type="button"
            className={mode === viewMode ? 'active' : undefined}
            onClick={() => setViewMode(mode)}
          >
            {label}
          </button>
        ))}
        <span className="hint">Double-click a bar to open the item in GitLab</span>
      </div>
      <div ref={chartRef} className="gantt-chart">
        <RowInfoContext.Provider value={rowInfo}>
          <Gantt
            tasks={tasks}
            viewMode={viewMode}
            preStepsCount={preStepsCount}
            todayColor="transparent"
            listCellWidth={`${LIST_WIDTH}px`}
            TaskListHeader={TaskListHeader}
            TaskListTable={TaskListTable}
            TooltipContent={TooltipContent}
            columnWidth={columnWidth}
            onExpanderClick={toggle}
            onDoubleClick={openInGitLab}
          />
        </RowInfoContext.Provider>
      </div>
    </div>
  );
};
