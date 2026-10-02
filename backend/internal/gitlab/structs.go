package gitlab

type GraphQLResponse struct {
	Data struct {
		Group *GroupData `json:"group"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors,omitempty"`
}

type GroupData struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	WorkItems  WorkItemConn  `json:"workItems"`
	Milestones MilestoneConn `json:"milestones"`
	Labels     LabelConn     `json:"labels"`
}

type LabelConn struct {
	PageInfo PageInfo `json:"pageInfo"`
	Nodes    []Label  `json:"nodes"`
}

type Label struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Color string `json:"color"` // hex, e.g. "#428bca"
}

type MilestoneConn struct {
	PageInfo PageInfo    `json:"pageInfo"`
	Nodes    []Milestone `json:"nodes"`
}

type WorkItemConn struct {
	PageInfo PageInfo       `json:"pageInfo"`
	Nodes    []WorkItemNode `json:"nodes"`
}

type PageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

type WorkItemNode struct {
	ID           string           `json:"id"`
	IID          string           `json:"iid"`
	Title        string           `json:"title"`
	State        string           `json:"state"`
	WebURL       string           `json:"webUrl"`
	WorkItemType WorkItemType     `json:"workItemType"`
	Widgets      []WorkItemWidget `json:"widgets"`
}

type WorkItemType struct {
	Name string `json:"name"`
}

// WorkItemWidget flattens the GraphQL fragments. The reliable discriminator is
// __typename (e.g. "WorkItemWidgetHierarchy"): the `type` field returns the
// enum value ("HIERARCHY", "MILESTONE", "START_AND_DUE_DATE").
type WorkItemWidget struct {
	Typename  string     `json:"__typename"`
	Type      string     `json:"type"`
	StartDate string     `json:"startDate,omitempty"`
	DueDate   string     `json:"dueDate,omitempty"`
	Milestone *Milestone `json:"milestone,omitempty"`
	Parent    *ParentRef `json:"parent,omitempty"`
	Weight    *int       `json:"weight,omitempty"` // nil: no weight set in GitLab
	Labels    *LabelConn `json:"labels,omitempty"`
	// HealthStatus: "onTrack", "needsAttention" or "atRisk", nil when unset.
	HealthStatus *string `json:"healthStatus,omitempty"`
	// Blocking links (WorkItemWidgetLinkedItems, aliased linkedItems queries).
	BlockedBy *LinkedItemConn `json:"blockedBy,omitempty"`
	Blocking  *LinkedItemConn `json:"blocking,omitempty"`
}

type LinkedItemConn struct {
	Nodes []LinkedItem `json:"nodes"`
}

// LinkedItem is the other end of a blocking link; it may be outside the group.
type LinkedItem struct {
	WorkItemState string          `json:"workItemState"` // "OPEN" or "CLOSED"
	WorkItem      *LinkedWorkItem `json:"workItem"`
}

type LinkedWorkItem struct {
	ID      string           `json:"id"`
	Title   string           `json:"title"`
	WebURL  string           `json:"webUrl"`
	Widgets []WorkItemWidget `json:"widgets"`
}

type Milestone struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	StartDate string `json:"startDate,omitempty"`
	DueDate   string `json:"dueDate,omitempty"`
	State     string `json:"state"`   // "active" or "closed"
	WebPath   string `json:"webPath"` // GitLab only exposes the relative path for milestones
	WebURL    string `json:"-"`       // absolute URL, computed by the client from WebPath
}

type ParentRef struct {
	ID string `json:"id"`
}
