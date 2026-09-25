package model

type GanttTaskType string

const (
	TypeMilestone GanttTaskType = "milestone"
	TypeEpic      GanttTaskType = "epic"
	TypeIssue     GanttTaskType = "issue"
)

type GanttTask struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Type     GanttTaskType `json:"type"`
	Start    string        `json:"start"`    // Format "YYYY-MM-DD"
	End      string        `json:"end"`      // Format "YYYY-MM-DD"
	Progress float64       `json:"progress"` // 0 to 100
	WebURL   string        `json:"webUrl,omitempty"`
	Children []GanttTask   `json:"children,omitempty"` // Recursive structure
}
