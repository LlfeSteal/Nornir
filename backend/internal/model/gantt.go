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
	LinearProgress float64 `json:"linearProgress"`
	WebURL         string  `json:"webUrl,omitempty"`
	Closed         bool    `json:"closed,omitempty"` // closed work item or milestone
	// NoStartDate / NoDueDate: the date is missing in GitLab, Start / End are made up (see
	// extractDates): the UI flags the row and doesn't judge its schedule.
	NoStartDate bool    `json:"noStartDate,omitempty"`
	NoDueDate   bool    `json:"noDueDate,omitempty"`
	Labels      []Label `json:"labels,omitempty"`
	// Health is the item's own GitLab health status (HealthOnTrack, HealthNeedsAttention,
	// HealthAtRisk), empty when unset. HealthBelow counts its open descendants that need
	// attention or are at risk, each once; nil when there are none.
	Health      string        `json:"health,omitempty"`
	HealthBelow *HealthCounts `json:"healthBelow,omitempty"`
	Children    []GanttTask   `json:"children,omitempty"` // Recursive structure
}

const (
	HealthOnTrack        = "onTrack"
	HealthNeedsAttention = "needsAttention"
	HealthAtRisk         = "atRisk"
)

// HealthCounts counts work items by health status.
type HealthCounts struct {
	AtRisk         int `json:"atRisk"`
	NeedsAttention int `json:"needsAttention"`
}

// Add counts one item of the given health status (other statuses don't count).
func (c *HealthCounts) Add(health string) {
	switch health {
	case HealthAtRisk:
		c.AtRisk++
	case HealthNeedsAttention:
		c.NeedsAttention++
	}
}

// Merge adds the counts of other, which may be nil.
func (c *HealthCounts) Merge(other *HealthCounts) {
	if other != nil {
		c.AtRisk += other.AtRisk
		c.NeedsAttention += other.NeedsAttention
	}
}

// OrNil returns a copy of the counts, or nil when they are all 0 (omitted from the JSON).
func (c HealthCounts) OrNil() *HealthCounts {
	if c.AtRisk == 0 && c.NeedsAttention == 0 {
		return nil
	}
	return &c
}

type Label struct {
	Title string `json:"title"`
	Color string `json:"color"`
}
