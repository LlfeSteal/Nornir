package gitlab

import (
	"encoding/json"
	"fmt"
	"testing"

	"nornir/internal/model"
)

// largeGroup mimics a production group (same shape as frontend/e2e/largeTree.ts): 30
// milestones, 40 top-level epics holding 5 epics holding 3 epics (840 epics), and 4,000
// issues under the deepest epics, half of them also in a milestone, all labeled.
func largeGroup() ([]WorkItemNode, []Milestone) {
	var milestones []Milestone
	for m := 0; m < 30; m++ {
		milestones = append(milestones, Milestone{ID: fmt.Sprintf("gid://gitlab/Milestone/%d", m), Title: fmt.Sprintf("Sprint %d", m), StartDate: "2026-01-01", DueDate: "2026-01-14"})
	}
	label := WorkItemWidget{Typename: typenameLabels, Labels: &LabelConn{Nodes: []Label{{Title: "team-a", Color: "#f0ad4e"}, {Title: "backend", Color: "#428bca"}}}}
	var nodes, deepest []WorkItemNode
	epic := func(id, parentID string) WorkItemNode {
		widgets := []WorkItemWidget{dates("2026-02-01", "2026-06-30"), label}
		if parentID != "" {
			widgets = append(widgets, parent(parentID))
		}
		n := node(id, "Epic", "OPEN", widgets...)
		nodes = append(nodes, n)
		return n
	}
	for a := 0; a < 40; a++ {
		top := epic(fmt.Sprintf("gid://gitlab/WorkItem/e%d", a), "")
		for b := 0; b < 5; b++ {
			child := epic(fmt.Sprintf("%s-%d", top.ID, b), top.ID)
			for c := 0; c < 3; c++ {
				deepest = append(deepest, epic(fmt.Sprintf("%s-%d", child.ID, c), child.ID))
			}
		}
	}
	for i := 0; i < 4000; i++ {
		widgets := []WorkItemWidget{dates("2026-03-01", "2026-03-10"), label, parent(deepest[i%len(deepest)].ID)}
		if i%2 == 0 {
			widgets = append(widgets, WorkItemWidget{Typename: typenameMilestone, Milestone: &milestones[i%30]})
		}
		nodes = append(nodes, node(fmt.Sprintf("gid://gitlab/WorkItem/i%d", i), "Issue", "OPEN", widgets...))
	}
	return nodes, milestones
}

func countTasks(tasks []model.GanttTask) int {
	n := len(tasks)
	for _, t := range tasks {
		n += countTasks(t.Children)
	}
	return n
}

func BenchmarkBuildGanttTree(b *testing.B) {
	nodes, milestones := largeGroup()
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
