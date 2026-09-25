package gitlab

import (
	"sort"
	"strings"
	"time"

	"nornir/internal/model"
)

const (
	dateLayout = "2006-01-02"

	typenameDates     = "WorkItemWidgetStartAndDueDate"
	typenameMilestone = "WorkItemWidgetMilestone"
	typenameHierarchy = "WorkItemWidgetHierarchy"

	// Suffixes of the extra copies of an item, followed by the ID tail of the item the
	// copied subtree is rooted at, so every ID stays unique in the UI:
	//   <id>_ms_<root>   copy under a milestone of an item also shown under its parent;
	//   <id>_root_<root> top-level copy of an epic that also sits under a parent or a milestone.
	milestoneCopySuffix = "_ms_"
	rootCopySuffix      = "_root_"
)

// parsedItem is a normalized work item, without its children.
type parsedItem struct {
	task              model.GanttTask
	closed            bool
	hierarchyParentID string
	milestoneKey      string // see milestoneKey()
}

// BuildGanttTree builds the Gantt tree in two phases:
//  1. index the nodes and the child lists (hierarchy and milestones);
//  2. materialize recursively, so every copy carries its whole subtree.
//
// Attachment rules:
//   - hierarchy parent present in the dataset → under that parent (ID unchanged);
//   - milestone → under the milestone whose title matches; the copy (and its subtree)
//     gets the `_ms_<id>` suffix if the item is also placed under a hierarchy parent;
//   - neither → root;
//   - every epic that is not already a root also gets a top-level copy (`_root_<id>`).
//
// Milestones are matched by title: milestones sharing a title (e.g. the same sprint in
// several projects) make a single row. All groupMilestones are shown, even with no
// attached item; milestones found only through widgets (e.g. inherited from a parent
// group) are added to them.
func BuildGanttTree(nodes []WorkItemNode, groupMilestones []Milestone) []model.GanttTask {
	return buildGanttTree(nodes, groupMilestones, time.Now())
}

func buildGanttTree(nodes []WorkItemNode, groupMilestones []Milestone, now time.Time) []model.GanttTask {
	items := make(map[string]*parsedItem, len(nodes))
	order := make([]string, 0, len(nodes))
	milestones := make(map[string]*model.GanttTask)
	milestoneOrder := make([]string, 0)

	addMilestone := func(ms *Milestone) {
		if ms == nil || ms.ID == "" {
			return
		}
		key := milestoneKey(ms)
		if _, exists := milestones[key]; exists {
			return
		}
		msStart := fallbackDate(ms.StartDate, now, 0)
		milestones[key] = &model.GanttTask{
			ID:     ms.ID,
			Name:   "[Milestone] " + ms.Title,
			Type:   model.TypeMilestone,
			Start:  msStart,
			End:    ensureEndAfterStart(msStart, fallbackDate(ms.DueDate, now, 30)),
			WebURL: ms.WebURL,
		}
		milestoneOrder = append(milestoneOrder, key)
	}
	for i := range groupMilestones {
		addMilestone(&groupMilestones[i])
	}

	// Phase 1a: normalization.
	for _, node := range nodes {
		if _, dup := items[node.ID]; dup {
			continue
		}
		start, end := extractDates(node.Widgets, now)
		item := &parsedItem{
			task: model.GanttTask{
				ID:     node.ID,
				Name:   node.Title,
				Type:   mapType(node.WorkItemType.Name),
				Start:  start,
				End:    end,
				WebURL: node.WebURL,
			},
			closed:            node.State == "CLOSED",
			hierarchyParentID: extractHierarchyParentID(node.Widgets),
		}

		if ms := extractMilestoneWidget(node.Widgets); ms != nil {
			item.milestoneKey = milestoneKey(ms)
			addMilestone(ms)
		}

		items[node.ID] = item
		order = append(order, node.ID)
	}

	// Phase 1b: child lists, in API order.
	hierarchyChildren := make(map[string][]string)
	milestoneChildren := make(map[string][]string)
	roots := make([]string, 0)

	for _, id := range order {
		item := items[id]
		hasHierarchyParent := false
		if item.hierarchyParentID != "" && item.hierarchyParentID != id {
			if _, exists := items[item.hierarchyParentID]; exists {
				hierarchyChildren[item.hierarchyParentID] = append(hierarchyChildren[item.hierarchyParentID], id)
				hasHierarchyParent = true
			}
		}
		// Keep the effective parent to decide the suffix in phase 2.
		if !hasHierarchyParent {
			item.hierarchyParentID = ""
		}
		if item.milestoneKey != "" {
			milestoneChildren[item.milestoneKey] = append(milestoneChildren[item.milestoneKey], id)
		}
		if !hasHierarchyParent && item.milestoneKey == "" {
			roots = append(roots, id)
		}
	}

	// Phase 2: recursive materialization.
	var materialize func(id, suffix string, visiting map[string]bool) model.GanttTask
	materialize = func(id, suffix string, visiting map[string]bool) model.GanttTask {
		item := items[id]
		task := item.task
		task.ID = id + suffix

		visiting[id] = true
		for _, childID := range hierarchyChildren[id] {
			if visiting[childID] { // guard against a cycle in the data
				continue
			}
			task.Children = append(task.Children, materialize(childID, suffix, visiting))
		}
		delete(visiting, id)

		task.Progress = computeProgress(item.closed, task.Children)
		return task
	}

	sort.SliceStable(milestoneOrder, func(i, j int) bool {
		a, b := milestones[milestoneOrder[i]], milestones[milestoneOrder[j]]
		if a.Start != b.Start {
			return a.Start < b.Start
		}
		return a.Name < b.Name
	})

	result := make([]model.GanttTask, 0, len(milestoneOrder)+len(roots))
	// canonical lists, in display order, the items placed without suffix and not under a
	// parent (milestone children without parent, then roots): the starting points of the
	// depth-first walk that orders the epic root copies.
	canonical := make([]string, 0)
	for _, key := range milestoneOrder {
		ms := *milestones[key]
		for _, childID := range milestoneChildren[key] {
			suffix := ""
			if items[childID].hierarchyParentID != "" {
				suffix = milestoneCopySuffix + lastSegment(childID)
			} else {
				canonical = append(canonical, childID)
			}
			ms.Children = append(ms.Children, materialize(childID, suffix, map[string]bool{}))
		}
		ms.Progress = computeProgress(false, ms.Children)
		result = append(result, ms)
	}
	isRoot := make(map[string]bool, len(roots))
	for _, id := range roots {
		isRoot[id] = true
		canonical = append(canonical, id)
		result = append(result, materialize(id, "", map[string]bool{}))
	}

	// Every epic that is not already a root is also listed at the top level.
	seen := make(map[string]bool)
	var collectEpics func(id string)
	collectEpics = func(id string) {
		if seen[id] {
			return
		}
		seen[id] = true
		if items[id].task.Type == model.TypeEpic && !isRoot[id] {
			result = append(result, materialize(id, rootCopySuffix+lastSegment(id), map[string]bool{}))
		}
		for _, childID := range hierarchyChildren[id] {
			collectEpics(childID)
		}
	}
	for _, id := range canonical {
		collectEpics(id)
	}
	return result
}

// milestoneKey identifies a milestone by its title (see BuildGanttTree), or by its ID
// when it has no title.
func milestoneKey(ms *Milestone) string {
	if title := strings.TrimSpace(ms.Title); title != "" {
		return "title:" + title
	}
	return "id:" + ms.ID
}

// lastSegment returns the numeric tail of a GitLab global ID
// ("gid://gitlab/WorkItem/42" → "42"), or the ID itself when it has no "/".
func lastSegment(id string) string {
	return id[strings.LastIndex(id, "/")+1:]
}

// computeProgress: mean of the children if any, otherwise 0/100 depending on state.
func computeProgress(closed bool, children []model.GanttTask) float64 {
	if len(children) == 0 {
		if closed {
			return 100
		}
		return 0
	}
	sum := 0.0
	for _, c := range children {
		sum += c.Progress
	}
	return sum / float64(len(children))
}

func extractHierarchyParentID(widgets []WorkItemWidget) string {
	for _, w := range widgets {
		if w.Typename == typenameHierarchy && w.Parent != nil {
			return w.Parent.ID
		}
	}
	return ""
}

func extractMilestoneWidget(widgets []WorkItemWidget) *Milestone {
	for _, w := range widgets {
		if w.Typename == typenameMilestone && w.Milestone != nil && w.Milestone.ID != "" {
			return w.Milestone
		}
	}
	return nil
}

func extractDates(widgets []WorkItemWidget, now time.Time) (string, string) {
	start, end := "", ""
	for _, w := range widgets {
		if w.Typename == typenameDates {
			start = w.StartDate
			end = w.DueDate
		}
	}
	switch {
	case start == "" && end != "":
		// Only the due date is known: show a 14-day bar ending on it.
		if due, err := time.Parse(dateLayout, end); err == nil {
			start = due.AddDate(0, 0, -14).Format(dateLayout)
		}
	case start != "" && end == "":
		if s, err := time.Parse(dateLayout, start); err == nil {
			end = s.AddDate(0, 0, 14).Format(dateLayout)
		}
	}
	start = fallbackDate(start, now, 0)
	end = fallbackDate(end, now, 14)
	return start, ensureEndAfterStart(start, end)
}

func fallbackDate(dateStr string, now time.Time, addDays int) string {
	if dateStr != "" {
		return dateStr
	}
	return now.AddDate(0, 0, addDays).Format(dateLayout)
}

// ensureEndAfterStart guarantees end > start (gantt-task-react mishandles inverted bars).
func ensureEndAfterStart(start, end string) string {
	s, errS := time.Parse(dateLayout, start)
	e, errE := time.Parse(dateLayout, end)
	if errS != nil || errE != nil {
		return end
	}
	if !e.After(s) {
		return s.AddDate(0, 0, 1).Format(dateLayout)
	}
	return end
}

func mapType(gitlabType string) model.GanttTaskType {
	if gitlabType == "Epic" {
		return model.TypeEpic
	}
	return model.TypeIssue
}
