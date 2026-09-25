# Nornir

Gantt chart of a GitLab group: the epics, milestones and issues of the group and its projects, with their hierarchy. An item attached to both an epic and a milestone shows up under both.

- Go backend (Gin) querying the GitLab GraphQL API, with a 5-minute cache.
- React + Vite frontend (`gantt-task-react`), served by nginx.

## Prerequisites

- Docker with Compose v2 (included in the project's devcontainer).
- A GitLab token with the `read_api` scope.
- To develop outside Docker: Go 1.21+ and Node 20+.

## Configuration

Copy `.env.example` to `.env` and fill in:

```
GITLAB_URL=https://gitlab.com        # GitLab instance
GITLAB_GROUP=my-org/my-group         # full path of the displayed group (required)
GITLAB_TOKEN=glpat-...               # read_api token
PORT=8080                            # backend port
```

## Running

**With Docker** (recommended):

```bash
docker compose up -d --build
```

Then open http://localhost. After editing `.env`: `docker compose up -d --force-recreate backend && docker compose up -d`.

**In development** (two terminals):

```bash
cd backend && (set -a; . ../.env; set +a; go run ./cmd/server)
cd frontend && npm install && npm run dev      # http://localhost:5173
```

## Usage

- Everything starts collapsed; the triangles expand or collapse a milestone or an epic. Expanded rows stay expanded after **Refresh**.
- Day / Week / Month views.
- Double-click a bar to open the item in GitLab.
- **Refresh** reloads from GitLab without waiting for the cache to expire.
- Items without dates in GitLab are shown over 14 days starting today.

## Tests

```bash
cd backend && go test ./...
cd frontend && npm run test:e2e:mocked   # Playwright, mocked API
cd frontend && npm run test:e2e          # + test against the real GitLab (docker stack running)
```

First time: `cd frontend && npx playwright install --with-deps chromium`.

## Contributing

Conventions, architecture and known pitfalls: see [AGENTS.md](AGENTS.md). Commits follow [Conventional Commits](https://www.conventionalcommits.org/), title only.
