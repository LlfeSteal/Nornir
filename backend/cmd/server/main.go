package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"nornir/internal/cache"
	"nornir/internal/gitlab"
	"nornir/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

// Encoded responses: fresh for 5 minutes, then served at once while a background fetch
// refreshes them, and dropped after a day. A fetch walks every page of the group: it may take
// minutes on a large group, so it gets its own timeout, independent of the request.
var appCache = cache.New(5*time.Minute, 24*time.Hour, 10*time.Minute)

type config struct {
	port      string
	gitlabURL string
	group     string // full path of the displayed GitLab group (GITLAB_GROUP)
	token     string // GITLAB_TOKEN, used when the request has no Authorization header
}

func loadConfig() config {
	cfg := config{
		port:      os.Getenv("PORT"),
		gitlabURL: strings.TrimRight(os.Getenv("GITLAB_URL"), "/"),
		group:     strings.Trim(os.Getenv("GITLAB_GROUP"), "/ "),
		token:     os.Getenv("GITLAB_TOKEN"),
	}
	if cfg.port == "" {
		cfg.port = "8080"
	}
	if cfg.gitlabURL == "" {
		cfg.gitlabURL = "https://gitlab.com"
	}
	if cfg.group == "" {
		log.Fatal("GITLAB_GROUP is required: set the full path of the GitLab group (e.g. my-org/my-group) in .env")
	}
	return cfg
}

func main() {
	_ = godotenv.Load()
	cfg := loadConfig()
	log.Printf("serving Gantt for group %q from %s", cfg.group, cfg.gitlabURL)

	r := gin.Default()
	r.GET("/api/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r.GET("/api/config", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"group": cfg.group, "gitlabUrl": cfg.gitlabURL})
	})
	r.GET("/api/gantt", cfg.handleGantt)
	r.GET("/api/labels", cfg.handleLabels)

	// Warm the cache with the configured token, so the first visitor doesn't wait for GitLab.
	if cfg.token != "" {
		token := "Bearer " + cfg.token
		appCache.Prefetch(cfg.ganttKey(token), cfg.fetchGantt(token))
		appCache.Prefetch(cfg.labelsKey(token), cfg.fetchLabels(token))
	}

	if err := r.Run(":" + cfg.port); err != nil {
		log.Fatal(err)
	}
}

// resolveToken returns the request's Authorization header, or GITLAB_TOKEN. When there is
// neither, it answers 401 and returns "".
func (cfg config) resolveToken(c *gin.Context) string {
	token := c.GetHeader("Authorization")
	if token == "" && cfg.token != "" {
		token = "Bearer " + cfg.token
	}
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no GitLab token: set GITLAB_TOKEN or send an Authorization header"})
	}
	return token
}

// Cache keys include a token fingerprint: data fetched with one user's permissions must
// never be served to a request carrying another token.
func (cfg config) ganttKey(token string) string {
	return "gantt_tree:" + tokenFingerprint(token) + ":" + cfg.group
}

func (cfg config) labelsKey(token string) string {
	return "labels:" + tokenFingerprint(token) + ":" + cfg.group
}

func (cfg config) handleGantt(c *gin.Context) {
	token := cfg.resolveToken(c)
	if token == "" {
		return
	}
	serveCached(c, cfg.ganttKey(token), cfg.fetchGantt(token))
}

// handleLabels lists the labels of the group (and of its ancestors), for the label filter.
// Separate from /api/gantt: on large hierarchies it can take many pages.
func (cfg config) handleLabels(c *gin.Context) {
	token := cfg.resolveToken(c)
	if token == "" {
		return
	}
	serveCached(c, cfg.labelsKey(token), cfg.fetchLabels(token))
}

// serveCached answers with the cached data of key (see cache.Store.Get). ?refresh=1 waits
// for fresh data. X-Cache says how it was served, X-Fetched-At when the data was fetched.
func serveCached(c *gin.Context, key string, fetch cache.FetchFunc) {
	entry, state, err := appCache.Get(c.Request.Context(), key, c.Query("refresh") == "1", fetch)
	if err != nil {
		if c.Request.Context().Err() != nil {
			return // the client is gone; the fetch goes on and fills the cache
		}
		respondGitLabError(c, err)
		return
	}
	c.Header("X-Cache", string(state))
	c.Header("X-Fetched-At", entry.FetchedAt.UTC().Format(time.RFC3339))
	c.Data(http.StatusOK, "application/json; charset=utf-8", entry.Body)
}

// fetchGantt walks the work items and the milestones of the group (in parallel), builds the
// tree and encodes it once for every request served from the cache.
func (cfg config) fetchGantt(token string) cache.FetchFunc {
	return func(ctx context.Context) ([]byte, error) {
		started := time.Now()
		var milestones []gitlab.Milestone
		var milestonesErr error
		done := make(chan struct{})
		go func() {
			defer close(done)
			milestones, milestonesErr = gitlab.FetchGroupMilestones(ctx, cfg.gitlabURL, token, cfg.group)
		}()
		nodes, err := gitlab.FetchAllWorkItems(ctx, cfg.gitlabURL, token, cfg.group)
		<-done
		if err != nil {
			return nil, err
		}
		if milestonesErr != nil {
			return nil, milestonesErr
		}
		tree := gitlab.BuildGanttTree(nodes, milestones)
		body, err := json.Marshal(tree)
		if err != nil {
			return nil, fmt.Errorf("encoding the tree: %w", err)
		}
		log.Printf("gantt: %d work items, %d milestones, %d rows, %d KB, fetched in %s",
			len(nodes), len(milestones), countRows(tree), len(body)/1024, time.Since(started).Round(time.Millisecond))
		return body, nil
	}
}

func (cfg config) fetchLabels(token string) cache.FetchFunc {
	return func(ctx context.Context) ([]byte, error) {
		labels, err := gitlab.FetchGroupLabels(ctx, cfg.gitlabURL, token, cfg.group)
		if err != nil {
			return nil, err
		}
		out := make([]model.Label, 0, len(labels))
		for _, l := range labels {
			out = append(out, model.Label{Title: l.Title, Color: l.Color})
		}
		return json.Marshal(out)
	}
}

func countRows(tasks []model.GanttTask) int {
	n := len(tasks)
	for _, t := range tasks {
		n += countRows(t.Children)
	}
	return n
}

func respondGitLabError(c *gin.Context, err error) {
	status := http.StatusBadGateway
	switch {
	case errors.Is(err, gitlab.ErrGroupNotFound):
		status = http.StatusNotFound
	case errors.Is(err, gitlab.ErrUnauthorized):
		status = http.StatusUnauthorized
	}
	c.JSON(status, gin.H{"error": err.Error()})
}

func tokenFingerprint(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:8])
}
