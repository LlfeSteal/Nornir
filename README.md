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

- Milestones list the work items whose milestone has the same title (milestones with the same title in several projects make one row).
- Every epic is also listed at the top level, on top of its place under its parent epic.
- Expanded children appear right below their parent, indented with tree lines, on a band in the parent's color (purple for a milestone, blue for an epic), with lighter bars than the top-level rows.
- Everything starts collapsed; the chevrons expand or collapse a milestone or an epic. Expanded rows stay expanded after **Refresh**.
- The toolbar holds the time scale (Day / Week / Month), **Today** (scrolls back to today) and **Refresh**, with the time of the last update.
- The chart grows with its rows up to the window height; beyond that, the rows scroll inside it while the calendar header stays in view.
- The chart opens centered on today, marked by a red line and a "Today" label; switching the time scale centers it again.
- **Appearance** menu in the toolbar: Automatic (follows your system), Light or Dark — remembered in the browser.
- The list shows the item names; hover a bar to see its dates and progress.
- Closed items (issues, epics, milestones) are **hidden by default**; the **Closed** button in the toolbar shows them (remembered in the browser). Hiding a closed epic or milestone also hides its content. When shown, they are grayed out in the list and drawn hatched in gray on the timeline.
- Epic and milestone bars are colored by schedule: **green** when the real progress is at or above the expected progress, **orange** when it is up to 5 points behind, **red** when it is more than 5 points behind. Issues are teal.
- Epic and milestone bars have three layers: the planned period (transparent), the **expected** progress if the work advanced evenly between their start and end dates (semi-transparent), and the **real** progress (solid). When the solid part is shorter than the semi-transparent one, the item is behind schedule; the tooltip says by how much ("Expected 80% · 30% behind").
- Progress is computed level by level: an item is at the mean of its direct children's progress, each weighted by its GitLab `weight` (1 point when it has none); a closed issue is at 100%. For example, 2 issues of 5 points with one closed → 50%; a capability with 3 unweighted features at 50%, 0% and 0% → 16.67%.
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
