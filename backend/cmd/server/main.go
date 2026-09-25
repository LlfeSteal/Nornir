package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"nornir/internal/gitlab"
	"nornir/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/patrickmn/go-cache"
)

// In-memory cache: 5-minute TTL, expired entries purged every 10 minutes
var appCache = cache.New(5*time.Minute, 10*time.Minute)

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

	if err := r.Run(":" + cfg.port); err != nil {
		log.Fatal(err)
	}
}

func (cfg config) handleGantt(c *gin.Context) {
	token := c.GetHeader("Authorization")
	if token == "" && cfg.token != "" {
		token = "Bearer " + cfg.token
	}
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no GitLab token: set GITLAB_TOKEN or send an Authorization header"})
		return
	}

	// The key includes a token fingerprint: a tree fetched with one user's permissions
	// must never be served to a request carrying another token.
	cacheKey := "gantt_tree:" + tokenFingerprint(token) + ":" + cfg.group

	// 1. Cache lookup (unless ?refresh=1)
	if c.Query("refresh") != "1" {
		if cachedTree, found := appCache.Get(cacheKey); found {
			c.Header("X-Cache", "HIT")
			c.JSON(http.StatusOK, cachedTree.([]model.GanttTask))
			return
		}
	}

	// 2. GraphQL fetch on cache miss
	ctx := c.Request.Context()
	allNodes, err := gitlab.FetchAllWorkItems(ctx, cfg.gitlabURL, token, cfg.group)
	if err != nil {
		respondGitLabError(c, err)
		return
	}
	milestones, err := gitlab.FetchGroupMilestones(ctx, cfg.gitlabURL, token, cfg.group)
	if err != nil {
		respondGitLabError(c, err)
		return
	}

	// 3. Build the Gantt tree
	tree := gitlab.BuildGanttTree(allNodes, milestones)

	// 4. Store in cache
	appCache.Set(cacheKey, tree, cache.DefaultExpiration)

	c.Header("X-Cache", "MISS")
	c.JSON(http.StatusOK, tree)
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
