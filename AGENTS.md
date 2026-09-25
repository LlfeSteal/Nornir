# AGENTS.md — Nornir

Reference for any agent (or human) working in this repository. Read it fully before changing code, and **keep it up to date** (see "Working rules").

## The project

**Nornir** shows the Gantt chart of **one** GitLab group: its epics, milestones and issues/tasks (including those of the group's projects).

- **Backend**: Go 1.21+ / Gin. Queries the GitLab GraphQL API, builds a tree, caches it in memory for 5 min (go-cache).
- **Frontend**: React 18 + TypeScript + Vite, rendered with `gantt-task-react`, HTTP via axios.
- **Deployment**: `docker compose` — Go backend (alpine image) + nginx serving the SPA and proxying `/api/` to the backend.

## Layout

```
backend/
  cmd/server/main.go                config (env), Gin routes, cache, /api/gantt handler
  internal/gitlab/client.go         paginated GraphQL queries (work items, milestones), error handling
  internal/gitlab/structs.go        GraphQL deserialization structs
  internal/gitlab/tree_builder.go   tree-building algorithm (core business logic)
  internal/gitlab/tree_builder_test.go
  internal/model/gantt.go           GanttTask pivot model (JSON sent to the frontend)
frontend/
  src/App.tsx                       page: title + group, Refresh button, loading/error states
  src/api/gantt.ts                  fetchConfig, fetchGantt, errorMessage
  src/components/GanttChart.tsx     adapter to gantt-task-react, view modes, collapsing
  src/utils/flatten.ts              tree flattening (parent before children)
  src/types/gantt.ts                TypeScript model (mirror of internal/model)
  e2e/                              Playwright tests (config in frontend/playwright.config.ts)
  nginx.conf, Dockerfile
docker-compose.yml                  compose project "nornir" (nornir-backend, nornir-frontend)
.env / .env.example                 configuration (.env is never committed)
.devcontainer/                      Go 1.22 image + node + docker-in-docker
README.md                           user-facing documentation
CLAUDE.md                           just imports this file
```

## Commands

```bash
# Backend
cd backend && go vet ./... && go test ./...
# godotenv only reads .env from the current directory: export the root one before go run
cd backend && (set -a; . ../.env; set +a; go run ./cmd/server)

# Frontend
cd frontend && npm run build                # tsc + vite build
cd frontend && npm run dev                  # http://localhost:5173, proxies /api → localhost:8080

# End-to-end tests (Playwright)
cd frontend && npm run test:e2e:mocked      # mocked API, no GitLab needed
cd frontend && npm run test:e2e             # everything, including @live (real GitLab through the docker stack)
npx playwright install --with-deps chromium # once per container, if Chromium is missing

# Full stack
docker compose up -d --build                # http://localhost
docker compose down
```

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `GITLAB_URL` | GitLab instance (default `https://gitlab.com`) |
| `GITLAB_GROUP` | **Required.** Full path of the displayed group (e.g. `my-org/my-group`). The backend refuses to start without it. |
| `GITLAB_TOKEN` | GitLab token, `read_api` scope. Used when the request carries no `Authorization` header. |
| `PORT` | Backend port (default 8080) |

- **Never print or commit the token.** `.env` is in `.gitignore`.
- After editing `.env`: `docker compose up -d --force-recreate backend` then `docker compose up -d` (recreating the backend can leave `nornir-frontend` in the `Created` state).

## Backend API

- `GET /api/health` → `{"status":"ok"}`
- `GET /api/config` → `{"group", "gitlabUrl"}` (never the token)
- `GET /api/gantt` → `GanttTask[]` tree of the configured group. `?refresh=1` bypasses the cache. Header `X-Cache: HIT|MISS`. Errors: 401 (token), 404 (group not found), 502 (other GitLab error), body `{"error": "..."}`.

## GitLab GraphQL pitfalls (learned the hard way)

- Widgets are identified by **`__typename`** (`WorkItemWidgetHierarchy`, `WorkItemWidgetMilestone`, `WorkItemWidgetStartAndDueDate`). The `type` field returns an enum value (`HIERARCHY`…): don't use it to discriminate.
- The **`Milestone` type has no `webUrl`**, only `webPath`: the absolute URL is rebuilt by `absoluteURL` in `client.go`.
- `group.workItems` needs **`includeDescendants: true`** to include issues from the group's projects.
- Pagination: `afterCursor` must be **`null`** (not `""`) on the first page.
- GraphQL errors come back as HTTP 200 with `errors[]`: they are surfaced as-is.
- **Any query change must be validated against the real GitLab** (the `@live` test, or a `curl` to `https://gitlab.com/api/graphql` with a public group such as `gitlab-org`). A local mock once accepted a field that doesn't exist.
- Many items have no dates (`startDate`/`dueDate` are `null`): that's expected, see fallback dates below.
- The weight comes from `WorkItemWidgetWeight { weight }` (`null` when unset). Weights are a paid-tier feature: on an instance whose schema lacks that type (e.g. GitLab CE), the fragment may make the whole query fail — run the `@live` test when targeting a new instance. GitLab's own `rolledUpWeight` is not used: it ignores unweighted items, while we count them as 1 point.

## `tree_builder.go` invariants

Covered by `tree_builder_test.go` — any behavior change must come with a test.

1. **Two phases**: index nodes and child lists, then materialize recursively. Don't go back to copying structs on the fly (grandchildren used to get lost).
2. **Multiple placements, unique IDs**: an item can be shown several times. Its canonical placement (under its hierarchy parent, or as a root, or under its milestone when it has no parent) keeps the GitLab ID. Every extra copy, **and its whole subtree**, gets a suffix naming the placement and the item the copy is rooted at (`lastSegment` of its GID): `_ms_<id>` for the copy under a milestone, `_root_<id>` for the top-level copy of an epic. IDs must stay unique across the whole tree (the UI requires it; tests check it through `mustBuild`) and deterministic (the UI keys its expanded state on them).
3. A hierarchy parent **missing** from the data doesn't count: the item becomes a root (or goes only under its milestone, without suffix).
4. **Deterministic order**: milestones sorted by start date then title, then roots in API order, then the epic top-level copies in depth-first order of the canonical tree. Never iterate over a map to produce output.
5. **Progress is weighted by the GitLab weight** (`progressTotals`): only the leaves of a subtree (items without children) count, each with its `weight`, or **1 point** when it has none (an explicit 0 counts as 0). Progress = closed weight ÷ total weight of the leaves, in percent; a leaf is 100 when closed, 0 otherwise; an item with children ignores its own state. A milestone sums its items' subtrees; an empty milestone is 0. If every leaf weighs 0, closed leaves are counted instead. Example: 2 issues of 5 points with one closed → 50%.
6. **Fallback dates**: no dates → today → +14 d; due date only → due −14 d; start only → start +14 d; milestone without dates → today → +30 d. Always `end > start` (otherwise `start + 1 d`).
7. **Milestones are matched by title** (`milestoneKey`): a milestone's children are the work items (epics or issues) whose `milestone { title }` equals its title, each with its subtree. Milestones sharing a title (group and projects) make one row, which keeps the ID, dates and URL of the first one registered — group milestones (`FetchGroupMilestones`) are registered first and shown **even when empty**; milestones found only through widgets (e.g. inherited from a parent group) are added after them.
8. **Every epic is also listed at the top level**: an epic that isn't already a root (it has a parent, or sits only under a milestone) gets a `_root_<id>` copy at the top level, with its subtree. Only epics are copied, not issues.

## Security

- The cache key includes a token fingerprint (`tokenFingerprint` in `main.go`). **Never key the cache on the group alone**: a tree fetched with one user's permissions would be served to another.

## Frontend

- `flattenGanttTree` yields a list where each parent precedes its children: `gantt-task-react` requires it.
- Any item with children (and every milestone) is a collapsible `project`; leaves are `task`s. Everything starts **collapsed**: `GanttChart` only tracks the `expanded` set, so groups that appear after a refresh are collapsed too. `App` keeps the chart mounted during a refresh so expanded rows survive it.
- `YYYY-MM-DD` dates are parsed in **local** time (`parseDay`), not with `new Date(iso)` (UTC).
- The list and the bar tooltip are our own components (`components/TaskList.tsx`, passed as `TaskListHeader` / `TaskListTable` / `TooltipContent`): the list shows only the item names; the dates are in the tooltip ("From … to …"). The e2e tests rely on the row structure: cell `div[title=name]` containing the `▶`/`▼` expander.
- Bar labels (`svg text`) don't receive pointer events: in tests, hover a bar by moving the mouse onto its label's bounding box.
- **Today line**: `gantt-task-react` can only fill today's whole column (`todayColor`, a whole week in Week view). We make that column transparent and `drawTodayLine` (in `GanttChart.tsx`) adds a `line.today-line` to the SVG at today's exact position inside the column (`columnFraction` in `utils/today.ts`). The library re-renders its SVG on its own, so a `MutationObserver` redraws the line.
- **Centering on today**: done by `centerOnTodayLine`, which scrolls the library's own horizontal scrollbar (the only `overflow-x: auto` div) to put the line in the middle, for ~0.5 s after the chart appears and after each view-mode change. **Don't use the `viewDate` prop** for this: the library resolves it against stale columns when its date range changes in the same render (first render, collapsed rows), so the scroll lands in the wrong place. `preStepsCount` is sized so the range starts at least half a screen before today, even when every item is in the future.
- Double-clicking a bar opens the item in GitLab.

## Tests

- **Go**: unit tests in `backend/internal/gitlab` (`buildGanttTree` takes an injected `now` to stay deterministic).
- **Playwright**: in `frontend/e2e/` — **every new Playwright test is saved in the project**, never thrown away.
  - `*.mocked.spec.ts`: API mocked with `page.route`, datasets in `e2e/fixtures.ts` (`mockApi`).
  - `*.live.spec.ts`: tagged `@live`, real backend + real GitLab; assumes nothing about the group's content.
  - Default target: the docker stack (`http://localhost`), override with `BASE_URL`.
  - **The docker stack serves the last *built image*, not your working tree.** To run the mocked tests against current code without rebuilding the image: `npm run build && npx vite preview --port 4173` then `BASE_URL=http://localhost:4173 npm run test:e2e:mocked` (the API is mocked, no backend needed). The `@live` test needs the stack rebuilt: `docker compose up -d --build`.

## Development environment

- Devcontainer: `mcr.microsoft.com/devcontainers/go:1-1.22-bookworm` image, features node, docker-in-docker (compose v2) and claude-code. Ports: 5173 (Vite), 8080 (API), 80 (compose nginx).
- Changing `.devcontainer/` requires the user to rebuild the container.

## Working rules

### Language

- **The whole project is in English**: code, identifiers, code comments, UI text, error messages, tests, documentation (`README.md`, `AGENTS.md`) and commit titles.
- Playwright selectors match UI text (`Refresh`, `No data to display.`, `Day/Week/Month`…): update the tests when changing that text.

### Commits

- **[Conventional Commits](https://www.conventionalcommits.org/)** format, **title only** (no body).
- The title must be **easy to understand** for someone who doesn't know the project: it says *what the commit changes*, imperative mood, no internal jargon.
- `type(scope): description` — types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`. Scopes: `backend`, `frontend`, `e2e`, `docker`, `devcontainer`, `docs`.
- Examples:
  - `feat(frontend): open the Gantt chart on today's date`
  - `fix(backend): read milestone links from webPath`
  - `test(e2e): check that collapsing an epic hides its children`
  - `docs: document the GITLAB_GROUP variable`
- One commit = one coherent change. Never commit `.env`, `node_modules/`, `dist/`, or Playwright reports.

### Before committing

1. `cd backend && go vet ./... && go test ./...`
2. `cd frontend && npm run build && npm run test:e2e:mocked` (against a fresh build — see Tests)
3. If the GitLab client or GraphQL queries changed: `npm run test:e2e` (includes `@live`) with the stack running.

### Documentation

- **Update `README.md`** for any user-visible change: configuration, commands, application behavior.
- **Update this `AGENTS.md`** whenever a new convention, pitfall, invariant, command or known limitation appears — or when something here becomes wrong.
- Documentation updates go **in the same commit** as the change they describe.

### Style

- Code comments are in English and concise; follow the surrounding style.
- Go formatted with `gofmt`. TypeScript in `strict` mode.

## Known limitations / ideas

- If today is after the end of every item (plus the library's padding: ~19 days in Day view, 1.5 months in Week view, the end of the year in Month view), there is no today line and no centering: the library can't extend its date range past the items.
- The library sizes its grid over all tasks, hidden ones included: the today line (like the grid) may extend below the last visible row, clipped by the SVG.
- The task list doesn't indent hierarchy levels (a `gantt-task-react` limitation).
- An item without dates but attached to a milestone doesn't inherit the milestone's dates.
- A cycle in the hierarchy (A parent of B, B parent of A) makes the involved items disappear.
