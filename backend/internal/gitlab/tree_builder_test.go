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
	tree := buildGanttTree([]WorkItemNode{
		node("task", "Task", "OPENED", parent("issue")),
		node("issue", "Issue", "OPENED", parent("epic")),
		node("epic", "Epic", "OPENED"),
	}, nil, fixedNow)

	assertIDs(t, "roots", tree, "epic")
	assertIDs(t, "epic children", tree[0].Children, "issue")
	assertIDs(t, "issue children", tree[0].Children[0].Children, "task")
	if tree[0].Type != model.TypeEpic || tree[0].Children[0].Type != model.TypeIssue {
		t.Fatalf("unexpected types: %v / %v", tree[0].Type, tree[0].Children[0].Type)
	}
}

func TestEpicAndMilestoneDuplicatesWithSuffixedSubtree(t *testing.T) {
	tree := buildGanttTree([]WorkItemNode{
		node("epic", "Epic", "OPENED"),
		node("issue", "Issue", "OPENED", parent("epic"), milestone("ms1", "2026-02-01")),
		node("task", "Task", "CLOSED", parent("issue")),
	}, nil, fixedNow)

	assertIDs(t, "roots", tree, "ms1", "epic")
	assertIDs(t, "milestone children", tree[0].Children, "issue_ms")
	assertIDs(t, "milestone grandchildren", tree[0].Children[0].Children, "task_ms")
	assertIDs(t, "epic children", tree[1].Children, "issue")
	assertIDs(t, "epic grandchildren", tree[1].Children[0].Children, "task")

	if got := tree[1].Children[0].Progress; got != 100 {
		t.Fatalf("issue progress = %v, want 100 (only child closed)", got)
	}
}

func TestMilestoneOnlyKeepsID(t *testing.T) {
	tree := buildGanttTree([]WorkItemNode{
		node("issue", "Issue", "OPENED", milestone("ms1", "")),
	}, nil, fixedNow)

	assertIDs(t, "roots", tree, "ms1")
	assertIDs(t, "milestone children", tree[0].Children, "issue")
	if tree[0].Start != "2026-01-10" || tree[0].End != "2026-02-09" {
		t.Fatalf("milestone fallback dates = %s..%s", tree[0].Start, tree[0].End)
	}
}

func TestMissingParentBecomesRoot(t *testing.T) {
	tree := buildGanttTree([]WorkItemNode{
		node("orphan", "Issue", "OPENED", parent("unknown")),
		node("plain", "Issue", "OPENED"),
	}, nil, fixedNow)

	assertIDs(t, "roots", tree, "orphan", "plain")
}

func TestMissingParentWithMilestoneIsNotSuffixed(t *testing.T) {
	tree := buildGanttTree([]WorkItemNode{
		node("issue", "Issue", "OPENED", parent("unknown"), milestone("ms1", "")),
	}, nil, fixedNow)

	assertIDs(t, "roots", tree, "ms1")
	assertIDs(t, "milestone children", tree[0].Children, "issue")
}

func TestMilestonesSortedByStartDate(t *testing.T) {
	tree := buildGanttTree([]WorkItemNode{
		node("a", "Issue", "OPENED", milestone("late", "2026-05-01")),
		node("b", "Issue", "OPENED", milestone("early", "2026-03-01")),
	}, nil, fixedNow)

	assertIDs(t, "roots", tree, "early", "late")
}

func TestWidgetsMatchedOnTypename(t *testing.T) {
	// The `type` field alone (enum value) must not be enough: that was the spec's bug.
	tree := buildGanttTree([]WorkItemNode{
		node("epic", "Epic", "OPENED"),
		node("issue", "Issue", "OPENED",
			WorkItemWidget{Type: "HIERARCHY", Parent: &ParentRef{ID: "epic"}},
			dates("2026-03-01", "2026-03-20"),
		),
	}, nil, fixedNow)

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
	tree := buildGanttTree([]WorkItemNode{
		node("issue", "Issue", "OPENED", milestone("ms1", "2026-02-01")),
	}, []Milestone{
		{ID: "empty", Title: "empty", StartDate: "2026-04-01", DueDate: "2026-04-30"},
		{ID: "ms1", Title: "ms1", StartDate: "2026-02-01"},
	}, fixedNow)

	assertIDs(t, "roots", tree, "ms1", "empty")
	assertIDs(t, "ms1 children", tree[0].Children, "issue")
	if len(tree[1].Children) != 0 || tree[1].Progress != 0 {
		t.Fatalf("empty milestone: children=%v progress=%v", tree[1].Children, tree[1].Progress)
	}
	if tree[1].End != "2026-04-30" {
		t.Fatalf("empty milestone end = %s", tree[1].End)
	}
}
