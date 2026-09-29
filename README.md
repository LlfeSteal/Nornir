# Nornir

Gantt chart of a GitLab group: the epics, milestones and issues of the group and its projects, with their hierarchy. An item attached to both an epic and a milestone shows up under both.

- Go backend (Gin) querying the GitLab GraphQL API, with an in-memory cache (see [Large groups](#large-groups)).
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
- The toolbar holds the period, the time scale (Day / Week / Month), **Today** (back to the current period, centered on today) and **Refresh**, with the time of the last update.
- **Period** (toolbar, `‹ 2026 ›`): the chart shows one period at a time so that long histories or far-off plans stay readable. The menu offers **This quarter**, **This year** (the default), **3 years** (last year to next year) and **All dates**; ‹ and › move one quarter or one year back or forward, to look at the past or further ahead. Items entirely outside the period are hidden (an epic or milestone stays when some of its content is in it), and bars crossing its edges are cut there — hover them for their real dates. Picking a period also picks a suitable time scale (Week for a quarter, Month otherwise). The chosen period is remembered in the browser; the arrows aren't. When nothing falls in the period, **Show all dates** brings everything back. Items without dates only show in periods that contain today.
- The chart grows with its rows up to the window height; beyond that, the rows scroll inside it while the calendar header stays in view.
- The chart opens centered on today, marked by a red line and a "Today" label; switching the time scale centers it again.
- **Appearance** menu in the toolbar: Automatic (follows your system), Light or Dark — remembered in the browser.
- The list shows the item names; hover a bar to see its dates and progress.
- **Filter bar** above the chart, to pick the items to show: a **Search** field (item names, ignoring case and accents), the **Milestones · Epics · Issues** toggles (all pressed at first; unpress a type to hide it, none pressed shows nothing) and the **Labels** menu, where you can check one or more labels (an item needs *any* of them). They combine: e.g. only **Epics** pressed + label `team-a` shows every epic labeled `team-a`; only **Milestones** pressed shows every milestone. Filtered items are listed flat at the top level, milestones first, then epics, then issues, each once and with its whole content (expand an epic to see all its children). Milestones carry no labels: with a label selected, a milestone shows when it holds an item carrying it. **Clear** brings back the normal view (every type pressed). The Labels menu lists the labels used in the chart first, then the group's other labels, with a search field when the list is long.
- Closed items (issues, epics, milestones) are **hidden by default**; the **Closed** button in the toolbar shows them (remembered in the browser). Hiding a closed epic or milestone also hides its content. When shown, they are grayed out in the list and drawn hatched in gray on the timeline.
- Epic and milestone bars are colored by schedule: **green** when the real progress is at or above the expected progress, **orange** when it is up to 5 points behind, **red** when it is more than 5 points behind. Issues are teal.
- Epic and milestone bars have three layers: the planned period (transparent), the **expected** progress if the work advanced evenly between their start and end dates (semi-transparent), and the **real** progress (solid). When the solid part is shorter than the semi-transparent one, the item is behind schedule; the tooltip says by how much ("Expected 80% · 30% behind").
- Progress is computed level by level: an item is at the mean of its direct children's progress, each weighted by its GitLab `weight` (1 point when it has none); a closed issue is at 100%. For example, 2 issues of 5 points with one closed → 50%; a capability with 3 unweighted features at 50%, 0% and 0% → 16.67%.
- Double-click a bar to open the item in GitLab.
- **Refresh** reloads from GitLab without waiting for the cache to expire (on a large group, this takes as long as a first load; the chart stays usable meanwhile).
- Items without dates in GitLab are shown on today only, just so they appear: a warning sign next to their name (hover it: "No dates in GitLab"), a gray bar with an orange dashed outline, and no schedule color (their dates are made up). With only one date, the bar spans 14 days from it and the warning says which date is missing.

## Large groups

Nornir is made for groups with thousands of milestones, epics and issues:

- **Cache.** Walking a large group takes GitLab many pages (100 items each), so the backend keeps the result in memory. Data less than 5 minutes old is served as is; older data (up to a day) is served **at once** while the backend fetches it again in the background, so the next visit is up to date. When `GITLAB_TOKEN` is set, the backend fills the cache when it starts, so the first visitor doesn't wait either. However many people open or refresh the chart, the backend fetches from GitLab **once at a time**, and a fetch goes on even when the page that started it is closed. Its log says how long each fetch took and how many items it found.

## Tests

```bash
cd backend && go test ./...
cd frontend && npm run test:e2e:mocked   # Playwright, mocked API
cd frontend && npm run test:e2e          # + test against the real GitLab (docker stack running)
```

First time: `cd frontend && npx playwright install --with-deps chromium`.

## Contributing

Conventions, architecture and known pitfalls: see [AGENTS.md](AGENTS.md). Commits follow [Conventional Commits](https://www.conventionalcommits.org/), title only.
