package gitlab

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"nornir/internal/model"
)

// deepGroup is the worst case for the tree: 5 levels of epics (20 → ×4 → ×4 → ×3 → ×3, 4,260
// epics), 3 issues under each deepest epic (8,640), and 40 milestones holding epics of the
// first two levels (with their whole subtree) and half of the issues. Every epic below the
// top level, or only under a milestone, is also copied at the top level with its subtree.
// Some items point to project milestones that share their title with a group milestone:
// they must be merged into one row.
//
// Same shape, IDs and order as deepTree() in frontend/e2e/largeTree.ts: both check the IDs
// of the tree against deepTreeSHA256, so the frontend's mock stays true to the backend.
var deepLevels = []int{20, 4, 4, 3, 3}

const (
	deepMilestones     = 40
	deepIssuesPerEpic  = 3
	deepRows           = 86270
	deepMaxDepth       = 6 // milestone → 5 levels of epics → issue
	deepTreeSHA256     = "939b761522c88bbe9faa5b9866a8de4e22c3a34a47cc1b65b509ae3eed273df5"
	deepMilestoneTitle = "Sprint %02d"
)

func deepGroup() ([]WorkItemNode, []Milestone) {
	var groupMilestones []Milestone
	for m := 0; m < deepMilestones; m++ {
		groupMilestones = append(groupMilestones, Milestone{
			ID: fmt.Sprintf("gid://gitlab/Milestone/%d", m), Title: fmt.Sprintf(deepMilestoneTitle, m),
			StartDate: day(14 * m), DueDate: day(14*m + 13), State: "active",
		})
	}
	// A milestone widget; every fourth one points to the project milestone of the same title.
	msWidget := func(m, n int) WorkItemWidget {
		ms := groupMilestones[m]
		if n%4 == 0 {
			ms.ID = fmt.Sprintf("gid://gitlab/Milestone/p%d", m)
		}
		return WorkItemWidget{Typename: typenameMilestone, Milestone: &ms}
	}
	labels := func(n int) WorkItemWidget {
		titles := []string{"backend", "frontend", "team-a", "team-b", "bug", "feature"}
		return WorkItemWidget{Typename: typenameLabels, Labels: &LabelConn{Nodes: []Label{{Title: titles[n%len(titles)], Color: "#428bca"}}}}
	}

	var nodes []WorkItemNode
	issues := 0
	var visit func(path []int, parentID string)
	visit = func(path []int, parentID string) {
		level := len(path) // 1 for the top level
		key := joinPath(path)
		id := "gid://gitlab/WorkItem/e" + key
		n := len(nodes)
		widgets := []WorkItemWidget{dates(day(path[0]*9+level*5), day(path[0]*9+level*5+120/level)), labels(n)}
		if parentID != "" {
			widgets = append(widgets, parent(parentID))
		}
		// Milestones hold half of the top-level epics and every second-level epic.
		if (level == 1 && path[0]%2 == 1) || level == 2 {
			widgets = append(widgets, msWidget((path[0]*4+path[len(path)-1])%deepMilestones, n))
		}
		epic := node(id, "Epic", "OPEN", widgets...)
		epic.Title = "Epic " + strings.ReplaceAll(key, "-", ".")
		nodes = append(nodes, epic)

		if level == len(deepLevels) {
			for k := 0; k < deepIssuesPerEpic; k++ {
				i := issues
				issues++
				state := "OPEN"
				if i%5 == 0 {
					state = "CLOSED"
				}
				w := []WorkItemWidget{dates(day(i%300), day(i%300+7)), labels(i), parent(id)}
				if i%2 == 0 {
					w = append(w, msWidget(i%deepMilestones, i))
				}
				issue := node(fmt.Sprintf("gid://gitlab/WorkItem/i%s-%d", key, k), "Issue", state, w...)
				issue.Title = fmt.Sprintf("Issue %s.%d", strings.ReplaceAll(key, "-", "."), k)
				nodes = append(nodes, issue)
			}
			return
		}
		for c := 0; c < deepLevels[level]; c++ {
			visit(append(append([]int{}, path...), c), id)
		}
	}
	for a := 0; a < deepLevels[0]; a++ {
		visit([]int{a}, "")
	}
	return nodes, groupMilestones
}

func joinPath(path []int) string {
	parts := make([]string, len(path))
	for i, p := range path {
		parts[i] = fmt.Sprint(p)
	}
	return strings.Join(parts, "-")
}

// day returns 2026-01-01 plus offset days.
func day(offset int) string {
	return fixedNow.AddDate(0, 0, offset-9).Format(dateLayout)
}

// treeFingerprint hashes the IDs of the tree in depth-first order, one per line.
func treeFingerprint(tasks []model.GanttTask) (rows, depth int, sum string) {
	h := sha256.New()
	var walk func([]model.GanttTask, int)
	walk = func(list []model.GanttTask, d int) {
		for _, t := range list {
			rows++
			if d > depth {
				depth = d
			}
			fmt.Fprintln(h, t.ID)
			walk(t.Children, d+1)
		}
	}
	walk(tasks, 0)
	return rows, depth, hex.EncodeToString(h.Sum(nil))
}

func TestDeepGroupTree(t *testing.T) {
	nodes, milestones := deepGroup()
	tree := mustBuild(t, nodes, milestones) // checks that every ID is unique

	rows, depth, sum := treeFingerprint(tree)
	if rows != deepRows || depth != deepMaxDepth {
		t.Fatalf("got %d rows, depth %d; want %d rows, depth %d", rows, depth, deepRows, deepMaxDepth)
	}
	if sum != deepTreeSHA256 {
		t.Fatalf("IDs fingerprint %s, want %s (update deepTree() in frontend/e2e/largeTree.ts too)", sum, deepTreeSHA256)
	}

	// Project milestones sharing a title with a group milestone are merged into its row.
	titles := map[string]bool{}
	for _, task := range tree[:deepMilestones] {
		if task.Type != model.TypeMilestone || titles[task.Name] || strings.Contains(task.ID, "/p") {
			t.Fatalf("unexpected milestone row %s %q", task.ID, task.Name)
		}
		titles[task.Name] = true
	}
	if tree[deepMilestones].Type == model.TypeMilestone {
		t.Fatal("more milestone rows than group milestones")
	}

	// Every epic that isn't a root has its top-level copy.
	top := map[string]bool{}
	for _, task := range tree {
		top[task.ID] = true
	}
	for _, n := range nodes {
		if n.WorkItemType.Name != "Epic" || top[n.ID] {
			continue
		}
		if copyID := n.ID + rootCopySuffix + lastSegment(n.ID); !top[copyID] {
			t.Fatalf("no top-level copy %s", copyID)
		}
	}
}

func BenchmarkBuildDeepGroup(b *testing.B) {
	nodes, milestones := deepGroup()
	var tree []model.GanttTask
	for i := 0; i < b.N; i++ {
		tree = buildGanttTree(nodes, milestones, fixedNow)
	}
	body, err := json.Marshal(tree)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportMetric(float64(countTasks(tree)), "rows")
	b.ReportMetric(float64(len(body))/1e6, "MB-json")
}
