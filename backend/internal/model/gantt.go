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
	NoStartDate bool `json:"noStartDate,omitempty"`
	NoDueDate   bool `json:"noDueDate,omitempty"`
	// NoChildren: an open epic or milestone without any child item in GitLab (closed ones
	// included). Its progress comes from its children, so it can't be tracked.
	NoChildren bool    `json:"noChildren,omitempty"`
	Labels     []Label `json:"labels,omitempty"`
	// Subgroup: path of the item's GitLab subgroup relative to the displayed group
	// ("team/backend"), empty when the item is in the group itself. Never on milestones.
	Subgroup string `json:"subgroup,omitempty"`
	// Health is the item's own GitLab health status (HealthOnTrack, HealthNeedsAttention,
	// HealthAtRisk), empty when unset. HealthBelow counts its open descendants that need
	// attention or are at risk, each once; nil when there are none.
	Health      string        `json:"health,omitempty"`
	HealthBelow *HealthCounts `json:"healthBelow,omitempty"`
	// BlockedBy / Blocking: the GitLab "blocked by" / "blocks" links of a work item (never
	// set on milestones), in API order.
	BlockedBy []DependencyRef `json:"blockedBy,omitempty"`
	Blocking  []DependencyRef `json:"blocking,omitempty"`
	Children  []GanttTask     `json:"children,omitempty"` // Recursive structure
}

// DependencyRef is the other end of a blocking link. ID is its GitLab global ID, never
// suffixed: the UI finds the item's rows from it. External: the item is not in the
// group's data (another group or project); its name, dates and state come with the link.
type DependencyRef struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	WebURL      string `json:"webUrl,omitempty"`
	Start       string `json:"start"`
	End         string `json:"end"`
	Closed      bool   `json:"closed,omitempty"`
	NoStartDate bool   `json:"noStartDate,omitempty"`
	NoDueDate   bool   `json:"noDueDate,omitempty"`
	External    bool   `json:"external,omitempty"`
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

// Subgroup is a subgroup of the displayed group (any level), Path relative to it.
type Subgroup struct {
	Path string `json:"path"`
	Name string `json:"name"`
}
