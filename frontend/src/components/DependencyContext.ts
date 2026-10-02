import { createContext } from 'react';
import { GanttTask } from '../types/gantt';
import { DependencyIndex } from '../utils/dependencies';

/** The links of the chart's tree and how to show a row's: the rows read it without going
 * through the memoized chart rows. None in the dependencies dialog (no nested dialogs). */
export const DependencyContext = createContext<{ index: DependencyIndex; open: (node: GanttTask) => void } | null>(null);
