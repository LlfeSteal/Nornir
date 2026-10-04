# Nornir

Gantt chart of a GitLab group: the epics, milestones and issues of the group and its projects, with their hierarchy. An item attached to both an epic and a milestone shows up under both.

- Go backend (Gin) querying the GitLab GraphQL API, with an in-memory cache (see [Large groups](#large-groups)).
- React + Vite frontend with its own Gantt chart in plain HTML and CSS, served by nginx.

## Prerequisites

- Docker with Compose v2 (included in the project's devcontainer), or a Kubernetes cluster with Helm 3.
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

**On Kubernetes**: with the Helm chart in [`charts/nornir`](charts/nornir/README.md) (build and push the two images, then `helm install nornir charts/nornir --set gitlab.group=my-org/my-group --set gitlab.existingSecret=<secret>`; optional Ingress).

**Private certificate authority**: for a self-hosted GitLab signed by an internal CA, the backend needs that CA (otherwise it reports `x509: certificate signed by unknown authority`). With Helm, set `privateCA` (see the [chart's README](charts/nornir/README.md#private-certificate-authority)). With Docker Compose, add a `docker-compose.override.yml` next to `docker-compose.yml`:

```yaml
services:
  backend:
    environment:
      SSL_CERT_DIR: /etc/ssl/certs:/etc/nornir/ca   # system CAs + yours
    volumes:
      - ./corp-ca.pem:/etc/nornir/ca/corp-ca.pem:ro
```

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
- The toolbar holds the period, the time scale (Day / Week / Month), **Today** (back to the current period, centered on today) and **Refresh**, with the time the data was fetched from GitLab.
- **Period** (toolbar, `‹ 2026 ›`): the chart shows one period at a time so that long histories or far-off plans stay readable. The menu offers **This quarter**, **This year** (the default), **3 years** (last year to next year) and **All dates**; ‹ and › move one quarter or one year back or forward, to look at the past or further ahead. Items entirely outside the period are hidden (an epic or milestone stays when some of its content is in it), and bars crossing its edges are cut there — hover them for their real dates. Picking a period also picks a suitable time scale (Week for a quarter, Month otherwise). The chosen period is remembered in the browser; the arrows aren't. When nothing falls in the period, **Show all dates** brings everything back. Items without dates only show in periods that contain today.
- The chart grows with its rows up to the window height; beyond that, the rows scroll inside it while the calendar header stays in view.
- The chart opens centered on today, marked by a red line and a "Today" label; switching the time scale centers it again.
- **Appearance** menu in the toolbar: Automatic (follows your system), Light or Dark — remembered in the browser.
- The list shows the item names; hover a bar to see its dates and progress.
- **Filter bar** above the chart, to pick the items to show: a **Search** field (item names, ignoring case and accents), the **Milestones · Epics · Issues** toggles (all pressed at first; unpress a type to hide it, none pressed shows nothing) and the **Labels** menu, where you can check one or more labels (an item needs *any* of them). and the **Health** menu (At risk, Needs attention, On track). They combine: e.g. only **Epics** pressed + label `team-a` shows every epic labeled `team-a`; only **Milestones** pressed shows every milestone. Filtered items are listed flat at the top level, milestones first, then epics, then issues, each once and with its whole content (expand an epic to see all its children). Milestones carry no labels: with a label selected, a milestone shows when it holds an item carrying it. **Clear** brings back the normal view (every type pressed). The Labels menu lists the labels used in the chart first, then the group's other labels, with a search field when the list is long.
- **Portfolios** are saved views: set filters (search, types, labels, health, Blocked, attention counts), a period and a time scale, then **Save as portfolio…** at the bottom of the **Portfolio** menu (first control of the filter bar) to keep them under a name. Picking a portfolio brings back all of it; **No portfolio** clears the filters (the period and the scale stay). The button names the portfolio whose view is shown, and adds **(edited)** once you change it: the bottom of the menu then offers **Update “<name>”** to keep the new view. Point at a portfolio in the menu to manage it from its row: the **star** makes it the **default** (it opens automatically when you open Nornir without a view in the address; the default keeps its orange star), the **pencil** (or **F2**) renames it in place — **Return** to keep the name, **Escape** to cancel — and the **bin** deletes it after asking on the row. Portfolios are kept in your browser only (nothing on the server, nothing shared with other users).
- **Shareable views**: the address bar always holds the view — period, time scale and filters — so a reload keeps it and **Copy link** (end of the filter bar) gives a link that opens the same chart for someone else. A link carries the filters, never the portfolio's name: a colleague who saved the same view as a portfolio of their own sees its name. A link always opens on its own view, whatever the recipient's own preferences or default portfolio.
- **Attention summary**, under the filter bar: how many items are **late** or **behind** schedule, **at risk** or **need attention** (GitLab health), **blocked**, start **before a blocker ends**, end **past their parent**, have **no dates** or epics/milestones **without children** — among the items of the period, each item counted once, closed items never. Click a count to list those items (several counts: items with any of them); click it again to go back.
- Closed items (issues, epics, milestones) are **hidden by default**; the **Closed** button in the toolbar shows them (remembered in the browser). Hiding a closed epic or milestone also hides its content. When shown, they are grayed out in the list and drawn hatched in gray on the timeline.
- Epic and milestone bars are colored by schedule: **green** when the real progress is at or above the expected progress, **orange** when it is up to 5 points behind, **red** when it is more than 5 points behind. Issues are teal.
- Epic and milestone bars have three layers: the planned period (transparent), the **expected** progress if the work advanced evenly between their start and end dates (semi-transparent), and the **real** progress (solid). When the solid part is shorter than the semi-transparent one, the item is behind schedule; the tooltip says by how much ("Expected 80% · 30% behind").
- Progress is computed level by level: an item is at the mean of its direct children's progress, each weighted by its GitLab `weight` (1 point when it has none); a closed issue is at 100%. For example, 2 issues of 5 points with one closed → 50%; a capability with 3 unweighted features at 50%, 0% and 0% → 16.67%.
- Double-click a bar to open the item in GitLab.
- **Refresh** reloads from GitLab without waiting for the cache to expire (on a large group, this takes as long as a first load; the chart stays usable meanwhile).
- **Health status** (GitLab's *Needs attention* / *At risk*, a paid-tier feature): a **red octagon** (at risk) or an **orange circle** (needs attention) with a white exclamation mark, at the end of the item's row in the list (the bars stay clean). The same mark flags the item itself and any item holding an open item (child, grandchild… or an item of the milestone) that needs attention or is at risk — hover it to see which ("At risk", or "1 at risk · 2 need attention below"). Closed items don't count. The bar tooltip shows the item's own status ("Health: On track") and the counts below. The **Health** menu of the filter bar lists the items with the checked statuses (milestones by the items they hold). The legend shows both icons. They never change the bar color, which stays the schedule's.
- **Planned past its parent**: when an item ends after the item it is shown under (its epic, or its milestone), the part of its bar beyond the parent's end is **hatched in red** — one day late, one day hatched. The tooltip says by how much ("Ends 3 days after Payments"). Starting before the parent isn't flagged, nor are closed items or items whose due date (or their parent's) is missing in GitLab.
- **Epics and milestones without child items** get an orange warning sign at the end of their row: an item's progress comes from its children, so an empty epic stays at 0% until it is closed and an empty milestone stays at 0% — their progress can't be tracked, and they get no schedule color. Hover the sign to read why; an item with several warnings (e.g. no dates *and* no child items) lists them one per line, in the sign's help tag and in the bar tooltip. Closed items aren't flagged.
- **Dependencies** (GitLab's *blocks* / *is blocked by* links, a paid-tier feature): an item with an open blocker gets a red **no-entry sign** at the end of its row (hover it: "Blocked by Payments"), and its tooltip lists what it is blocked by and what it blocks. When an item is planned to start before an open blocker ends, the start of its bar is **hatched in red** up to the end of its latest blocker, and its tooltip says so ("Starts 3 days before Payments ends"). The **Blocked** button of the filter bar lists the blocked items. Every row that is blocked, or holds a blocked epic or issue, shows a small **link pill** with the number of links: click it to open the **dependencies** of that row in a dialog. They are **what must be done to finish it**: the blockers of the row and of its epics and issues, the blockers of those blockers, and so on (a blocker's own epics and issues included). What the row only unblocks elsewhere isn't there: a feature of milestone 2 waiting for a feature of milestone 1 shows in the dependencies of milestone 2, not of milestone 1. The dialog lists the items involved under their epics, fully expanded — a parent without a link of its own, such as a capability holding the features, is shown for its place — each blocker before what it blocks as far as the hierarchy allows, with an **arrow** from the end of each blocker to the start of what it blocks (red when it starts before its blocker ends). Blockers from elsewhere in the group (another milestone or epic) or from outside it are grayed and say where they sit. The dialog brings the **critical path** forward — the chain of open blockers that sets the latest end: it is computed on the **user stories** (the issues, and epics without any) of the whole row: it ends at the one that finishes last and goes back, at each step, through the user story that holds it up the longest, wherever it sits. A blocker of an epic holds up all its user stories, and a blocking epic counts through its own user stories, not its dates: such a step, which goes through epics rather than a direct link, is drawn **dashed** (its tooltip says which epics: "after US 10 (through Feature 4 → Feature 1)"). A user story of the path without links of its own is added to the dialog. Its items are in bold, its arrows thicker in black (white in dark mode), even when they conflict — the red hatch on the bars shows that — and everything else fades. **Critical path only** hides everything else, keeping only the path's items under their parents. Arrows coming into rows that start on the same day keep apart, and so do arrows from different blockers that turn at the same place. It has its own time scale; **Escape**, **Close** or a click outside it closes it. Closed blockers don't count while closed items are hidden.
- Items without dates in GitLab are shown on today only, just so they appear: a warning sign at the end of their row (hover it: "No dates in GitLab"), a gray bar with a gray dashed outline, and no schedule color (their dates are made up). With only one date, the bar spans 14 days from it and the warning says which date is missing.

## Large groups

Nornir is made for groups with thousands of milestones, epics and issues:

- **Cache.** Walking a large group takes GitLab many pages (100 items each), so the backend keeps the result in memory. Data less than 5 minutes old is served as is; older data (up to a day) is served **at once** while the backend fetches it again in the background, so the next visit is up to date. When `GITLAB_TOKEN` is set, the backend fills the cache when it starts, so the first visitor doesn't wait either. However many people open or refresh the chart, the backend fetches from GitLab **once at a time**, and a fetch goes on even when the page that started it is closed. Its log says how long each fetch took and how many items it found.
- **Chart.** Only the rows on screen are drawn, so scrolling, expanding and filtering stay immediate with tens of thousands of rows.
- **Transfer.** nginx compresses the responses (a group of 5,000 items is about 4 MB of JSON, ten times less compressed).

## Tests

```bash
cd backend && go test ./...
cd frontend && npm run test:unit         # Vitest, unit tests of the chart logic
cd frontend && npm run test:e2e:mocked   # Playwright, mocked API
cd frontend && npm run test:e2e          # + test against the real GitLab (docker stack running)
```

First time: `cd frontend && npx playwright install --with-deps chromium`.

## Contributing

Conventions, architecture and known pitfalls: see [AGENTS.md](AGENTS.md). Commits follow [Conventional Commits](https://www.conventionalcommits.org/), title only.
