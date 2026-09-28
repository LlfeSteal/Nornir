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
	// LinearProgress is the progress expected today if the work advanced evenly between
	// Start and End (0 to 100): comparing it with Progress tells whether the row is ahead
	// or behind schedule.
	LinearProgress float64     `json:"linearProgress"`
	WebURL         string      `json:"webUrl,omitempty"`
	Closed         bool        `json:"closed,omitempty"` // closed work item or milestone
	Labels         []Label     `json:"labels,omitempty"`
	Children       []GanttTask `json:"children,omitempty"` // Recursive structure
}

type Label struct {
	Title string `json:"title"`
	Color string `json:"color"`
}
