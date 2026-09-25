package gitlab

import (
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
	if tree[0].Start != "2026-01-10" || tree[0].End != "2026-02-09" {
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
		name               string
		widget             WorkItemWidget
		wantStart, wantEnd string
	}{
		{"none", dates("", ""), "2026-01-10", "2026-01-24"},
		{"due only", dates("", "2026-03-15"), "2026-03-01", "2026-03-15"},
		{"start only", dates("2026-03-01", ""), "2026-03-01", "2026-03-15"},
		{"inverted", dates("2026-03-10", "2026-03-01"), "2026-03-10", "2026-03-11"},
		{"same day", dates("2026-03-10", "2026-03-10"), "2026-03-10", "2026-03-11"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, end := extractDates([]WorkItemWidget{tc.widget}, fixedNow)
			if start != tc.wantStart || end != tc.wantEnd {
				t.Fatalf("got %s..%s, want %s..%s", start, end, tc.wantStart, tc.wantEnd)
			}
		})
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
