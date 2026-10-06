package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"nornir/internal/cache"
	"nornir/internal/model"

	"github.com/gin-gonic/gin"
)

// fakeGitLab answers the GraphQL queries with one epic and one milestone, after release is
// closed, and counts the work item queries.
func fakeGitLab(t *testing.T, release <-chan struct{}) (*httptest.Server, *int32) {
	var workItemQueries int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		<-release
		switch {
		case strings.Contains(string(body), "GetGanttWorkItems"):
			atomic.AddInt32(&workItemQueries, 1)
			io.WriteString(w, `{"data":{"group":{"workItems":{"pageInfo":{"hasNextPage":false},"nodes":[
				{"id":"gid://gitlab/WorkItem/1","title":"Epic","state":"OPEN","workItemType":{"name":"Epic"},"widgets":[]},
				{"id":"gid://gitlab/WorkItem/2","title":"Issue","state":"OPEN","workItemType":{"name":"Issue"},"widgets":[],
				 "namespace":{"id":"gid://gitlab/Namespaces::ProjectNamespace/7","fullPath":"demo/group/team/app"}}]}}}}`)
		case strings.Contains(string(body), "GetGroupMilestones"):
			io.WriteString(w, `{"data":{"group":{"milestones":{"pageInfo":{"hasNextPage":false},"nodes":[
				{"id":"gid://gitlab/Milestone/1","title":"Sprint","state":"active","webPath":"/m/1"}]}}}}`)
		case strings.Contains(string(body), "GetSubgroups"):
			io.WriteString(w, `{"data":{"group":{"descendantGroups":{"pageInfo":{"hasNextPage":false},"nodes":[
				{"fullPath":"demo/group/team/core","name":"Core"},{"fullPath":"demo/group/team","name":"Team"}]}}}}`)
		default:
			io.WriteString(w, `{"data":{"group":{"labels":{"pageInfo":{"hasNextPage":false},"nodes":[{"title":"bug","color":"#d9534f"}]}}}}`)
		}
	}))
	t.Cleanup(server.Close)
	return server, &workItemQueries
}

func newRouter(t *testing.T, gitlabURL string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	appCache = cache.New(5*time.Minute, 24*time.Hour, time.Minute)
	cfg := config{gitlabURL: gitlabURL, group: "demo/group", token: "secret"}
	r := gin.New()
	r.GET("/api/gantt", cfg.handleGantt)
	r.GET("/api/labels", cfg.handleLabels)
	r.GET("/api/subgroups", cfg.handleSubgroups)
	return r
}

func get(r *gin.Engine, url string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, url, nil))
	return w
}

func TestGanttRequestsShareOneGitLabFetch(t *testing.T) {
	release := make(chan struct{})
	gitlab, queries := fakeGitLab(t, release)
	r := newRouter(t, gitlab.URL)

	var wg sync.WaitGroup
	responses := make([]*httptest.ResponseRecorder, 5)
	for i := range responses {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			url := "/api/gantt"
			if i%2 == 1 {
				url += "?refresh=1"
			}
			responses[i] = get(r, url)
		}(i)
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()

	if n := atomic.LoadInt32(queries); n != 1 {
		t.Fatalf("GitLab queried %d times, want 1", n)
	}
	for _, w := range responses {
		if w.Code != http.StatusOK || w.Header().Get("X-Cache") != "MISS" {
			t.Fatalf("got %d %q: %s", w.Code, w.Header().Get("X-Cache"), w.Body)
		}
	}

	// Then served from the cache, with the time the data was fetched.
	w := get(r, "/api/gantt")
	if w.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("X-Cache = %q, want HIT", w.Header().Get("X-Cache"))
	}
	if _, err := time.Parse(time.RFC3339, w.Header().Get("X-Fetched-At")); err != nil {
		t.Fatalf("X-Fetched-At: %v", err)
	}
	var tree []model.GanttTask
	if err := json.Unmarshal(w.Body.Bytes(), &tree); err != nil {
		t.Fatal(err)
	}
	if len(tree) != 3 || tree[0].Name != "[Milestone] Sprint" || tree[1].Name != "Epic" || tree[2].Name != "Issue" {
		t.Fatalf("unexpected tree: %s", w.Body)
	}
}

func TestLabelsAreCachedToo(t *testing.T) {
	release := make(chan struct{})
	close(release)
	gitlab, _ := fakeGitLab(t, release)
	r := newRouter(t, gitlab.URL)

	if w := get(r, "/api/labels"); w.Code != http.StatusOK || w.Body.String() != `[{"title":"bug","color":"#d9534f"}]` {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	if w := get(r, "/api/labels"); w.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("X-Cache = %q, want HIT", w.Header().Get("X-Cache"))
	}
}

func TestSubgroupsAreListedRelativeToTheGroup(t *testing.T) {
	release := make(chan struct{})
	close(release)
	gitlab, _ := fakeGitLab(t, release)
	r := newRouter(t, gitlab.URL)

	want := `[{"path":"team","name":"Team"},{"path":"team/core","name":"Core"}]`
	if w := get(r, "/api/subgroups"); w.Code != http.StatusOK || w.Body.String() != want {
		t.Fatalf("got %d %s, want %s", w.Code, w.Body, want)
	}
	if w := get(r, "/api/subgroups"); w.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("X-Cache = %q, want HIT", w.Header().Get("X-Cache"))
	}
}

func TestGanttRowsCarryTheirSubgroup(t *testing.T) {
	release := make(chan struct{})
	close(release)
	gitlab, _ := fakeGitLab(t, release)
	r := newRouter(t, gitlab.URL)

	w := get(r, "/api/gantt")
	var tree []model.GanttTask
	if err := json.Unmarshal(w.Body.Bytes(), &tree); err != nil {
		t.Fatal(err)
	}
	subgroups := map[string]string{}
	for _, task := range tree {
		subgroups[task.Name] = task.Subgroup
	}
	if subgroups["Epic"] != "" || subgroups["Issue"] != "team" {
		t.Fatalf("subgroups = %v, want Epic in the group and Issue in team", subgroups)
	}
}
