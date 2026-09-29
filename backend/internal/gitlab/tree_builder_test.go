package gitlab

import (
	"math"
	"strings"
	"testing"
	"time"

	"nornir/internal/model"
)

var fixedNow = time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)

func node(id, typ, state string, widgets ...WorkItemWidget) WorkItemNode {
	return WorkItemNode{
		ID:           id,
		Title:        "title " + id,
		State:        state,
		WorkItemType: WorkItemType{Name: typ},
		Widgets:      widgets,
	}
}

func parent(id string) WorkItemWidget {
	return WorkItemWidget{Typename: typenameHierarchy, Type: "HIERARCHY", Parent: &ParentRef{ID: id}}
}

func milestone(id, start string) WorkItemWidget {
	return WorkItemWidget{Typename: typenameMilestone, Type: "MILESTONE", Milestone: &Milestone{ID: id, Title: id, StartDate: start}}
}

func dates(start, due string) WorkItemWidget {
	return WorkItemWidget{Typename: typenameDates, Type: "START_AND_DUE_DATE", StartDate: start, DueDate: due}
}

// ids returns the IDs of one tree level.
func milestoneTitled(id, title string) WorkItemWidget {
	return WorkItemWidget{Typename: typenameMilestone, Type: "MILESTONE", Milestone: &Milestone{ID: id, Title: title}}
}

// mustBuild builds the tree at fixedNow and checks that every ID in it is unique,
// which the UI requires.
func mustBuild(t *testing.T, nodes []WorkItemNode, groupMilestones []Milestone) []model.GanttTask {
	t.Helper()
	tree := buildGanttTree(nodes, groupMilestones, fixedNow)
	seen := map[string]bool{}
	var walk func([]model.GanttTask)
	walk = func(tasks []model.GanttTask) {
		for _, task := range tasks {
			if seen[task.ID] {
				t.Fatalf("duplicate ID %q in tree", task.ID)
			}
			seen[task.ID] = true
			walk(task.Children)
		}
	}
	walk(tree)
	return tree
}

func ids(tasks []model.GanttTask) []string {
	out := make([]string, len(tasks))
	for i, t := range tasks {
		out[i] = t.ID
	}
	return out
}

func assertIDs(t *testing.T, label string, got []model.GanttTask, want ...string) {
	t.Helper()
	g := ids(got)
	if len(g) != len(want) {
		t.Fatalf("%s: got %v, want %v", label, g, want)
	}
	for i := range want {
		if g[i] != want[i] {
			t.Fatalf("%s: got %v, want %v", label, g, want)
		}
	}
}

func TestGrandchildrenAreKept(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("task", "Task", "OPENED", parent("issue")),
		node("issue", "Issue", "OPENED", parent("epic")),
		node("epic", "Epic", "OPENED"),
	}, nil)

	assertIDs(t, "roots", tree, "epic")
	assertIDs(t, "epic children", tree[0].Children, "issue")
	assertIDs(t, "issue children", tree[0].Children[0].Children, "task")
	if tree[0].Type != model.TypeEpic || tree[0].Children[0].Type != model.TypeIssue {
		t.Fatalf("unexpected types: %v / %v", tree[0].Type, tree[0].Children[0].Type)
	}
}

func TestEpicAndMilestoneDuplicatesWithSuffixedSubtree(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("epic", "Epic", "OPENED"),
		node("issue", "Issue", "OPENED", parent("epic"), milestone("ms1", "2026-02-01")),
		node("task", "Task", "CLOSED", parent("issue")),
	}, nil)

	assertIDs(t, "roots", tree, "ms1", "epic")
	assertIDs(t, "milestone children", tree[0].Children, "issue_ms_issue")
	assertIDs(t, "milestone grandchildren", tree[0].Children[0].Children, "task_ms_issue")
	assertIDs(t, "epic children", tree[1].Children, "issue")
	assertIDs(t, "epic grandchildren", tree[1].Children[0].Children, "task")

	if got := tree[1].Children[0].Progress; got != 100 {
		t.Fatalf("issue progress = %v, want 100 (only child closed)", got)
	}
}

func TestMilestoneOnlyKeepsID(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("issue", "Issue", "OPENED", milestone("ms1", "")),
	}, nil)

	assertIDs(t, "roots", tree, "ms1")
	assertIDs(t, "milestone children", tree[0].Children, "issue")
	if tree[0].Start != "2026-01-10" || tree[0].End != "2026-01-11" || !tree[0].NoStartDate || !tree[0].NoDueDate {
		t.Fatalf("milestone fallback dates = %s..%s", tree[0].Start, tree[0].End)
	}
}

func TestMissingParentBecomesRoot(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("orphan", "Issue", "OPENED", parent("unknown")),
		node("plain", "Issue", "OPENED"),
	}, nil)

	assertIDs(t, "roots", tree, "orphan", "plain")
}

func TestMissingParentWithMilestoneIsNotSuffixed(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("issue", "Issue", "OPENED", parent("unknown"), milestone("ms1", "")),
	}, nil)

	assertIDs(t, "roots", tree, "ms1")
	assertIDs(t, "milestone children", tree[0].Children, "issue")
}

func TestMilestonesSortedByStartDate(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("a", "Issue", "OPENED", milestone("late", "2026-05-01")),
		node("b", "Issue", "OPENED", milestone("early", "2026-03-01")),
	}, nil)

	assertIDs(t, "roots", tree, "early", "late")
}

func TestWidgetsMatchedOnTypename(t *testing.T) {
	// The `type` field alone (enum value) must not be enough: that was the spec's bug.
	tree := mustBuild(t, []WorkItemNode{
		node("epic", "Epic", "OPENED"),
		node("issue", "Issue", "OPENED",
			WorkItemWidget{Type: "HIERARCHY", Parent: &ParentRef{ID: "epic"}},
			dates("2026-03-01", "2026-03-20"),
		),
	}, nil)

	assertIDs(t, "roots", tree, "epic", "issue")
	if tree[1].Start != "2026-03-01" || tree[1].End != "2026-03-20" {
		t.Fatalf("dates = %s..%s", tree[1].Start, tree[1].End)
	}
}

func TestDateFallbacks(t *testing.T) {
	cases := []struct {
		name                   string
		widgets                []WorkItemWidget
		wantStart, wantEnd     string
		wantNoStart, wantNoDue bool
	}{
		{"none", []WorkItemWidget{dates("", "")}, "2026-01-10", "2026-01-11", true, true},
		{"no widget", nil, "2026-01-10", "2026-01-11", true, true},
		{"due only", []WorkItemWidget{dates("", "2026-03-15")}, "2026-03-01", "2026-03-15", true, false},
		{"start only", []WorkItemWidget{dates("2026-03-01", "")}, "2026-03-01", "2026-03-15", false, true},
		{"inverted", []WorkItemWidget{dates("2026-03-10", "2026-03-01")}, "2026-03-10", "2026-03-11", false, false},
		{"same day", []WorkItemWidget{dates("2026-03-10", "2026-03-10")}, "2026-03-10", "2026-03-11", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, end, noStart, noDue := extractDates(tc.widgets, fixedNow)
			if start != tc.wantStart || end != tc.wantEnd {
				t.Fatalf("got %s..%s, want %s..%s", start, end, tc.wantStart, tc.wantEnd)
			}
			if noStart != tc.wantNoStart || noDue != tc.wantNoDue {
				t.Fatalf("got noStart=%v noDue=%v, want %v %v", noStart, noDue, tc.wantNoStart, tc.wantNoDue)
			}
		})
	}
}

func TestMissingDatesAreFlagged(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("undated", "Epic", "OPEN"),
		node("child", "Issue", "OPEN", parent("undated"), dates("2026-02-01", "2026-02-10")),
	}, []Milestone{
		{ID: "ms-undated", Title: "No dates"},
		{ID: "ms-dated", Title: "Dated", StartDate: "2026-02-01", DueDate: "2026-02-28"},
	})

	byID := map[string]model.GanttTask{}
	var walk func([]model.GanttTask)
	walk = func(tasks []model.GanttTask) {
		for _, task := range tasks {
			byID[task.ID] = task
			walk(task.Children)
		}
	}
	walk(tree)
	want := map[string]struct {
		start, end     string
		noStart, noDue bool
	}{
		// Undated rows sit on today only, whatever their children's dates.
		"undated":    {"2026-01-10", "2026-01-11", true, true},
		"child":      {"2026-02-01", "2026-02-10", false, false},
		"ms-undated": {"2026-01-10", "2026-01-11", true, true},
		"ms-dated":   {"2026-02-01", "2026-02-28", false, false},
	}
	for id, w := range want {
		got := byID[id]
		if got.Start != w.start || got.End != w.end || got.NoStartDate != w.noStart || got.NoDueDate != w.noDue {
			t.Errorf("%s = %s..%s noStart=%v noDue=%v, want %s..%s %v %v",
				id, got.Start, got.End, got.NoStartDate, got.NoDueDate, w.start, w.end, w.noStart, w.noDue)
		}
	}
}

func TestEmptyGroupMilestoneIsShown(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("issue", "Issue", "OPENED", milestone("ms1", "2026-02-01")),
	}, []Milestone{
		{ID: "empty", Title: "empty", StartDate: "2026-04-01", DueDate: "2026-04-30"},
		{ID: "ms1", Title: "ms1", StartDate: "2026-02-01"},
	})

	assertIDs(t, "roots", tree, "ms1", "empty")
	assertIDs(t, "ms1 children", tree[0].Children, "issue")
	if len(tree[1].Children) != 0 || tree[1].Progress != 0 {
		t.Fatalf("empty milestone: children=%v progress=%v", tree[1].Children, tree[1].Progress)
	}
	if tree[1].End != "2026-04-30" {
		t.Fatalf("empty milestone end = %s", tree[1].End)
	}
}

func TestMilestonesMatchedByTitle(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("a", "Issue", "OPENED", milestoneTitled("project-ms", "Sprint 1")),
		node("b", "Epic", "OPENED", milestoneTitled("other-project-ms", "Sprint 1")),
		node("c", "Issue", "OPENED", milestoneTitled("ms2", "Sprint 2")),
	}, []Milestone{{ID: "group-ms", Title: "Sprint 1", StartDate: "2026-02-01"}})

	// The group milestone and the two project milestones named "Sprint 1" make one row,
	// which keeps the group milestone's ID.
	assertIDs(t, "roots", tree, "ms2", "group-ms", "b_root_b") // b is an epic: also at the root
	assertIDs(t, "Sprint 1 children", tree[1].Children, "a", "b")
	assertIDs(t, "Sprint 2 children", tree[0].Children, "c")
}

func TestEveryEpicIsAlsoListedAtRoot(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("gid://gitlab/WorkItem/1", "Epic", "OPENED"),
		node("gid://gitlab/WorkItem/2", "Epic", "OPENED", parent("gid://gitlab/WorkItem/1")),
		node("gid://gitlab/WorkItem/3", "Epic", "OPENED", parent("gid://gitlab/WorkItem/2")),
		node("gid://gitlab/WorkItem/4", "Issue", "CLOSED", parent("gid://gitlab/WorkItem/3")),
		node("gid://gitlab/WorkItem/5", "Issue", "OPENED", parent("gid://gitlab/WorkItem/1")),
	}, nil)

	// Canonical tree first, then the top-level copies of the nested epics, depth-first.
	assertIDs(t, "roots", tree,
		"gid://gitlab/WorkItem/1",
		"gid://gitlab/WorkItem/2_root_2",
		"gid://gitlab/WorkItem/3_root_3",
	)
	assertIDs(t, "epic 1 children", tree[0].Children, "gid://gitlab/WorkItem/2", "gid://gitlab/WorkItem/5")
	assertIDs(t, "epic 2 copy children", tree[1].Children, "gid://gitlab/WorkItem/3_root_2")
	assertIDs(t, "epic 3 copy children", tree[2].Children, "gid://gitlab/WorkItem/4_root_3")
	if tree[2].Progress != 100 {
		t.Fatalf("epic 3 copy progress = %v, want 100", tree[2].Progress)
	}
}

func TestEpicUnderMilestoneOnlyIsAlsoListedAtRoot(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("epic", "Epic", "OPENED", milestone("ms1", "")),
		node("issue", "Issue", "OPENED", parent("epic")),
	}, nil)

	assertIDs(t, "roots", tree, "ms1", "epic_root_epic")
	assertIDs(t, "milestone children", tree[0].Children, "epic")
	assertIDs(t, "root copy children", tree[1].Children, "issue_root_epic")
}

func TestItemAndAncestorInSameMilestone(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("top", "Epic", "OPENED"),
		node("cap", "Epic", "OPENED", parent("top"), milestone("ms1", "")),
		node("feat", "Epic", "OPENED", parent("cap"), milestone("ms1", "")),
	}, nil)

	// feat shows up directly under the milestone and inside cap's copy, with distinct IDs.
	assertIDs(t, "milestone children", tree[0].Children, "cap_ms_cap", "feat_ms_feat")
	assertIDs(t, "cap copy children", tree[0].Children[0].Children, "feat_ms_cap")
	assertIDs(t, "roots", tree, "ms1", "top", "cap_root_cap", "feat_root_feat")
}

func weight(w int) WorkItemWidget {
	return WorkItemWidget{Typename: typenameWeight, Type: "WEIGHT", Weight: &w}
}

// progressOf finds a task by ID in the tree.
func progressOf(t *testing.T, tree []model.GanttTask, id string) float64 {
	t.Helper()
	var found *model.GanttTask
	var walk func([]model.GanttTask)
	walk = func(tasks []model.GanttTask) {
		for i := range tasks {
			if tasks[i].ID == id {
				found = &tasks[i]
			}
			walk(tasks[i].Children)
		}
	}
	walk(tree)
	if found == nil {
		t.Fatalf("task %q not found", id)
	}
	return found.Progress
}

func TestProgressUsesWeights(t *testing.T) {
	// Same shape as the real group: Feature 2 has two issues of 5 points (one closed),
	// Feature 1 has three issues without weight (one closed), which count 1 point each.
	tree := mustBuild(t, []WorkItemNode{
		node("epic1", "Epic", "OPEN"),
		node("cap2", "Epic", "OPEN", parent("epic1"), milestone("ms1", "")),
		node("feat2", "Epic", "OPEN", parent("cap2")),
		node("us2", "Issue", "CLOSED", parent("feat2"), weight(5)),
		node("us1", "Issue", "OPEN", parent("feat2"), weight(5)),
		node("feat1", "Epic", "OPEN", parent("cap2")),
		node("us8", "Issue", "CLOSED", parent("feat1")),
		node("us7", "Issue", "OPEN", parent("feat1")),
		node("us6", "Issue", "OPEN", parent("feat1")),
	}, nil)

	capability := (50 + 100.0/3) / 2 // mean of its two unweighted features
	cases := map[string]float64{
		"feat2":        50,        // (5×100 + 5×0) / 10
		"feat1":        100.0 / 3, // unweighted issues: 1 point each
		"cap2":         capability,
		"ms1":          capability, // the milestone holds cap2's copy only
		"cap2_ms_cap2": capability,
		"epic1":        capability,
		"us2":          100,
		"us1":          0,
	}
	for id, want := range cases {
		if got := progressOf(t, tree, id); math.Abs(got-want) > 1e-9 {
			t.Errorf("%s progress = %v, want %v", id, got, want)
		}
	}
}

func TestProgressWithOnlyZeroWeightsIsPlainMean(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("epic", "Epic", "OPEN"),
		node("a", "Issue", "CLOSED", parent("epic"), weight(0)),
		node("b", "Issue", "OPEN", parent("epic"), weight(0)),
	}, nil)

	if got := progressOf(t, tree, "epic"); got != 50 {
		t.Fatalf("epic progress = %v, want 50", got)
	}
}

func TestCapabilityAveragesItsFeaturesByWeight(t *testing.T) {
	features := func(weights ...WorkItemWidget) []WorkItemNode {
		nodes := []WorkItemNode{
			node("cap", "Epic", "OPEN"),
			node("f1", "Epic", "OPEN", append([]WorkItemWidget{parent("cap")}, weights[0])...),
			node("f2", "Epic", "OPEN", append([]WorkItemWidget{parent("cap")}, weights[1])...),
			node("f3", "Epic", "OPEN", append([]WorkItemWidget{parent("cap")}, weights[2])...),
			// f1 is at 50%, f2 and f3 at 0%.
			node("a", "Issue", "CLOSED", parent("f1")),
			node("b", "Issue", "OPEN", parent("f1")),
			node("c", "Issue", "OPEN", parent("f2")),
			node("d", "Issue", "OPEN", parent("f3")),
		}
		return nodes
	}
	noWeight := WorkItemWidget{Typename: typenameWeight, Type: "WEIGHT"}

	// Unweighted features count 1 each: 50 / 3.
	if got := progressOf(t, mustBuild(t, features(noWeight, noWeight, noWeight), nil), "cap"); math.Abs(got-50.0/3) > 1e-9 {
		t.Fatalf("unweighted features: cap progress = %v, want %v", got, 50.0/3)
	}
	// Feature weights 2, 1, 1: (2×50) / 4.
	if got := progressOf(t, mustBuild(t, features(weight(2), weight(1), weight(1)), nil), "cap"); got != 25 {
		t.Fatalf("weighted features: cap progress = %v, want 25", got)
	}
}

func TestLinearProgressFromOwnDates(t *testing.T) {
	now := time.Date(2026, 1, 6, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name       string
		start, end string
		want       float64
	}{
		{"half way", "2026-01-01", "2026-01-11", 50},
		{"not started", "2026-01-10", "2026-01-20", 0},
		{"overdue", "2025-12-01", "2026-01-01", 100},
		{"starts today", "2026-01-06", "2026-01-16", 0},
		{"invalid", "", "2026-01-16", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := linearProgress(tc.start, tc.end, now); math.Abs(got-tc.want) > 1e-9 {
				t.Fatalf("linearProgress(%s, %s) = %v, want %v", tc.start, tc.end, got, tc.want)
			}
		})
	}
}

func TestLinearProgressIsSetOnEveryRow(t *testing.T) {
	// fixedNow is 2026-01-10: the epic (Jan 1 → Jan 21) is at 9/20 days, the milestone
	// (Jan 5 → Jan 15) half way, and the issue (Jan 20 → Feb 3) hasn't started.
	tree := buildGanttTree([]WorkItemNode{
		node("epic", "Epic", "OPEN", dates("2026-01-01", "2026-01-21")),
		node("issue", "Issue", "OPEN", parent("epic"), dates("2026-01-20", "2026-02-03")),
	}, []Milestone{{ID: "ms", Title: "ms", StartDate: "2026-01-05", DueDate: "2026-01-15"}}, fixedNow)

	byID := map[string]model.GanttTask{}
	var walk func([]model.GanttTask)
	walk = func(tasks []model.GanttTask) {
		for _, task := range tasks {
			byID[task.ID] = task
			walk(task.Children)
		}
	}
	walk(tree)
	for id, want := range map[string]float64{"ms": 50, "epic": 45, "issue": 0} {
		if got := byID[id].LinearProgress; math.Abs(got-want) > 1e-9 {
			t.Errorf("%s linearProgress = %v, want %v", id, got, want)
		}
	}
}

func TestClosedItemsAndMilestonesAreFlagged(t *testing.T) {
	tree := mustBuild(t, []WorkItemNode{
		node("done", "Issue", "CLOSED", milestoneTitled("m-open", "Open sprint")),
		node("todo", "Issue", "OPEN", milestoneTitled("m-open", "Open sprint")),
	}, []Milestone{
		{ID: "m-open", Title: "Open sprint", State: "active"},
		{ID: "m-closed", Title: "Old sprint", State: "closed"},
	})

	closed := map[string]bool{}
	var walk func([]model.GanttTask)
	walk = func(tasks []model.GanttTask) {
		for _, task := range tasks {
			closed[task.ID] = task.Closed
			walk(task.Children)
		}
	}
	walk(tree)
	want := map[string]bool{"done": true, "todo": false, "m-open": false, "m-closed": true}
	for id, w := range want {
		if closed[id] != w {
			t.Errorf("%s closed = %v, want %v", id, closed[id], w)
		}
	}
}

func labels(titles ...string) WorkItemWidget {
	conn := &LabelConn{}
	for _, title := range titles {
		conn.Nodes = append(conn.Nodes, Label{ID: "label-" + title, Title: title, Color: "#" + title})
	}
	return WorkItemWidget{Typename: typenameLabels, Type: "LABELS", Labels: conn}
}

func TestLabelsAreSetOnEveryPlacement(t *testing.T) {
	// "issue" sits under its epic and, as a `_ms_` copy, under Sprint 1; "sub" is a nested
	// epic also listed at the top level (`_root_`).
	tree := mustBuild(t, []WorkItemNode{
		node("epic", "Epic", "OPEN", labels("team-a")),
		node("sub", "Epic", "OPEN", parent("epic"), labels("team-b")),
		node("issue", "Issue", "OPEN", parent("sub"), milestoneTitled("m1", "Sprint 1"), labels("backend", "bug")),
		node("bare", "Issue", "OPEN"),
	}, []Milestone{{ID: "m1", Title: "Sprint 1"}})

	byID := map[string]model.GanttTask{}
	var walk func([]model.GanttTask)
	walk = func(tasks []model.GanttTask) {
		for _, task := range tasks {
			byID[task.ID] = task
			walk(task.Children)
		}
	}
	walk(tree)

	titles := func(task model.GanttTask) []string {
		out := []string{}
		for _, l := range task.Labels {
			out = append(out, l.Title)
		}
		return out
	}
	want := map[string][]string{
		"m1":             {},
		"epic":           {"team-a"},
		"sub":            {"team-b"},
		"issue":          {"backend", "bug"},
		"issue_ms_issue": {"backend", "bug"},
		"sub_root_sub":   {"team-b"},
		"issue_root_sub": {"backend", "bug"},
		"bare":           {},
	}
	for id, w := range want {
		task, ok := byID[id]
		if !ok {
			t.Fatalf("%s not found in tree %v", id, ids(tree))
		}
		if got := titles(task); strings.Join(got, ",") != strings.Join(w, ",") {
			t.Errorf("%s labels = %v, want %v", id, got, w)
		}
	}
	if byID["issue"].Labels[0].Color != "#backend" {
		t.Errorf("label color = %q, want #backend", byID["issue"].Labels[0].Color)
	}
	if byID["bare"].Labels != nil {
		t.Errorf("an item without labels must have none, got %v", byID["bare"].Labels)
	}
}

func health(status string) WorkItemWidget {
	return WorkItemWidget{Typename: typenameHealth, Type: "HEALTH_STATUS", HealthStatus: &status}
}

func TestHealthStatusIsCountedOnAncestors(t *testing.T) {
	// epic > sub > {risky, closedRisky, closedParent > attention}, plus a milestone holding
	// "sub" and "attention": the milestone counts "attention" once.
	tree := mustBuild(t, []WorkItemNode{
		node("epic", "Epic", "OPEN", health(model.HealthOnTrack)),
		node("sub", "Epic", "OPEN", parent("epic"), milestoneTitled("m1", "Sprint 1"), health(model.HealthNeedsAttention)),
		node("risky", "Issue", "OPEN", parent("sub"), health(model.HealthAtRisk)),
		node("closedRisky", "Issue", "CLOSED", parent("sub"), health(model.HealthAtRisk)),
		node("closedParent", "Issue", "CLOSED", parent("sub")),
		node("attention", "Task", "OPEN", parent("closedParent"), milestoneTitled("m1", "Sprint 1"), health(model.HealthNeedsAttention)),
		node("plain", "Issue", "OPEN"),
	}, []Milestone{{ID: "m1", Title: "Sprint 1"}, {ID: "m2", Title: "Empty"}})

	byID := map[string]model.GanttTask{}
	var walk func([]model.GanttTask)
	walk = func(tasks []model.GanttTask) {
		for _, task := range tasks {
			byID[task.ID] = task
			walk(task.Children)
		}
	}
	walk(tree)

	counts := func(atRisk, attention int) *model.HealthCounts {
		return model.HealthCounts{AtRisk: atRisk, NeedsAttention: attention}.OrNil()
	}
	want := map[string]*model.HealthCounts{
		"epic":                   counts(1, 2), // sub (attention), risky, attention
		"sub":                    counts(1, 1), // closedRisky doesn't count
		"sub_root_sub":           counts(1, 1),
		"sub_ms_sub":             counts(1, 1),
		"closedParent":           counts(0, 1), // a closed item passes on its descendants
		"risky":                  nil,
		"attention":              nil,
		"m1":                     counts(1, 2), // "attention" is under m1 twice, counted once
		"m2":                     nil,
		"plain":                  nil,
		"attention_ms_attention": nil,
		"closedParent_root_sub":  counts(0, 1),
	}
	for id, w := range want {
		task, ok := byID[id]
		if !ok {
			t.Fatalf("%s not found in tree %v", id, ids(tree))
		}
		if (task.HealthBelow == nil) != (w == nil) || (w != nil && *task.HealthBelow != *w) {
			t.Errorf("%s healthBelow = %+v, want %+v", id, task.HealthBelow, w)
		}
	}
	for id, h := range map[string]string{"epic": model.HealthOnTrack, "sub_ms_sub": model.HealthNeedsAttention, "closedRisky": model.HealthAtRisk, "plain": ""} {
		if got := byID[id].Health; got != h {
			t.Errorf("%s health = %q, want %q", id, got, h)
		}
	}
}
