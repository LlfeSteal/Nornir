package gitlab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// ErrGroupNotFound is returned when GitLab answers `group: null`
// (unknown path or token without access).
var ErrGroupNotFound = errors.New("group not found or not accessible")

// ErrUnauthorized is returned when GitLab rejects the token (HTTP 401).
var ErrUnauthorized = errors.New("gitlab rejected the token")

const workItemsQuery = `query GetGanttWorkItems($fullPath: ID!, $afterCursor: String) {
  group(fullPath: $fullPath) {
    id
    name
    workItems(first: 100, after: $afterCursor, includeDescendants: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id iid title state webUrl
        workItemType { name }
        widgets {
          __typename
          type
          ... on WorkItemWidgetStartAndDueDate { startDate dueDate }
          ... on WorkItemWidgetMilestone { milestone { id title state startDate dueDate webPath } }
          ... on WorkItemWidgetHierarchy { parent { id } }
          ... on WorkItemWidgetWeight { weight }
          ... on WorkItemWidgetLabels { labels { nodes { id title color } } }
          ... on WorkItemWidgetHealthStatus { healthStatus }
          ... on WorkItemWidgetLinkedItems {
            blockedBy: linkedItems(filter: BLOCKED_BY, first: 50) { ...LinkedNodes }
            blocking: linkedItems(filter: BLOCKS, first: 50) { ...LinkedNodes }
          }
        }
      }
    }
  }
}

fragment LinkedNodes on LinkedWorkItemTypeConnection {
  nodes {
    workItemState
    workItem { id title webUrl widgets(onlyTypes: [START_AND_DUE_DATE]) { __typename ... on WorkItemWidgetStartAndDueDate { startDate dueDate } } }
  }
}`

const milestonesQuery = `query GetGroupMilestones($fullPath: ID!, $afterCursor: String) {
  group(fullPath: $fullPath) {
    id
    name
    milestones(first: 100, after: $afterCursor, includeAncestors: false) {
      pageInfo { hasNextPage endCursor }
      nodes { id title state startDate dueDate webPath }
    }
  }
}`

// Labels of the group and of its ancestors (project labels are only seen on the items).
const labelsQuery = `query GetGroupLabels($fullPath: ID!, $afterCursor: String) {
  group(fullPath: $fullPath) {
    id
    name
    labels(first: 100, after: $afterCursor, includeAncestorGroups: true) {
      pageInfo { hasNextPage endCursor }
      nodes { id title color }
    }
  }
}`

var httpClient = &http.Client{Timeout: 30 * time.Second}

// FetchAllWorkItems walks every page of work items of the group (and its projects).
// token is the full Authorization header value ("Bearer ...").
func FetchAllWorkItems(ctx context.Context, baseURL, token, fullPath string) ([]WorkItemNode, error) {
	var all []WorkItemNode
	err := paginate(ctx, baseURL, token, workItemsQuery, fullPath, func(g *GroupData) PageInfo {
		all = append(all, g.WorkItems.Nodes...)
		return g.WorkItems.PageInfo
	})
	for i := range all {
		for j := range all[i].Widgets {
			if ms := all[i].Widgets[j].Milestone; ms != nil {
				ms.WebURL = absoluteURL(baseURL, ms.WebPath)
			}
		}
	}
	return all, err
}

// FetchGroupMilestones returns all of the group's own milestones, including
// those with no work item attached.
func FetchGroupMilestones(ctx context.Context, baseURL, token, fullPath string) ([]Milestone, error) {
	var all []Milestone
	err := paginate(ctx, baseURL, token, milestonesQuery, fullPath, func(g *GroupData) PageInfo {
		all = append(all, g.Milestones.Nodes...)
		return g.Milestones.PageInfo
	})
	for i := range all {
		all[i].WebURL = absoluteURL(baseURL, all[i].WebPath)
	}
	return all, err
}

// FetchGroupLabels returns the labels available in the group (its own and its
// ancestors'), sorted by title.
func FetchGroupLabels(ctx context.Context, baseURL, token, fullPath string) ([]Label, error) {
	var all []Label
	err := paginate(ctx, baseURL, token, labelsQuery, fullPath, func(g *GroupData) PageInfo {
		all = append(all, g.Labels.Nodes...)
		return g.Labels.PageInfo
	})
	sort.SliceStable(all, func(i, j int) bool {
		return strings.ToLower(all[i].Title) < strings.ToLower(all[j].Title)
	})
	return all, err
}

// paginate runs query page by page; collect accumulates the nodes and returns the pageInfo.
func paginate(ctx context.Context, baseURL, token, query, fullPath string, collect func(*GroupData) PageInfo) error {
	endpoint := strings.TrimRight(baseURL, "/") + "/api/graphql"
	var cursor *string // nil → null on the first page

	for {
		group, err := doGraphQL(ctx, endpoint, token, query, map[string]interface{}{
			"fullPath":    fullPath,
			"afterCursor": cursor,
		})
		if err != nil {
			return err
		}
		pageInfo := collect(group)
		if !pageInfo.HasNextPage || pageInfo.EndCursor == "" {
			return nil
		}
		next := pageInfo.EndCursor
		cursor = &next
	}
}

func doGraphQL(ctx context.Context, endpoint, token, query string, variables map[string]interface{}) (*GroupData, error) {
	reqBody, err := json.Marshal(map[string]interface{}{
		"query":     query,
		"variables": variables,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gitlab request failed: %w", err)
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("reading gitlab response: %w", err)
	}

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrUnauthorized
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gitlab returned HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var gqlResp GraphQLResponse
	if err := json.Unmarshal(body, &gqlResp); err != nil {
		return nil, fmt.Errorf("decoding gitlab response: %w", err)
	}
	if len(gqlResp.Errors) > 0 {
		msgs := make([]string, len(gqlResp.Errors))
		for i, e := range gqlResp.Errors {
			msgs[i] = e.Message
		}
		return nil, fmt.Errorf("gitlab graphql error: %s", strings.Join(msgs, "; "))
	}
	if gqlResp.Data.Group == nil {
		return nil, ErrGroupNotFound
	}
	return gqlResp.Data.Group, nil
}

func absoluteURL(baseURL, path string) string {
	if path == "" {
		return ""
	}
	return strings.TrimRight(baseURL, "/") + path
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
