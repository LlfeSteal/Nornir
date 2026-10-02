# AGENTS.md — Nornir

Reference for any agent (or human) working in this repository. Read it fully before changing code, and **keep it up to date** (see "Working rules").

## The project

**Nornir** shows the Gantt chart of **one** GitLab group: its epics, milestones and issues/tasks (including those of the group's projects).

- **Backend**: Go 1.21+ / Gin. Queries the GitLab GraphQL API, builds a tree, keeps it encoded in an in-memory cache (`internal/cache`, see Backend API).
- **Frontend**: React 18 + TypeScript + Vite, our own virtualized Gantt chart in plain HTML/CSS (no chart library), HTTP via axios.
- **Deployment**: `docker compose` — Go backend (alpine image) + nginx serving the SPA and proxying `/api/` to the backend.

## Layout

```
backend/
  cmd/server/main.go                config (env), Gin routes, /api/gantt and /api/labels handlers, cache warm-up
  cmd/server/main_test.go           handlers against a fake GitLab
  internal/cache/cache.go           response cache: one fetch at a time per key, stale-while-revalidate
  internal/gitlab/client.go         paginated GraphQL queries (work items, milestones), error handling
  internal/gitlab/structs.go        GraphQL deserialization structs
  internal/gitlab/tree_builder.go   tree-building algorithm (core business logic)
  internal/gitlab/tree_builder_test.go
  internal/gitlab/tree_builder_bench_test.go   BenchmarkBuildGanttTree on a production-sized group
  internal/model/gantt.go           GanttTask pivot model (JSON sent to the frontend)
frontend/
  src/App.tsx                       page: title + group, Refresh button, loading/error states
  src/api/gantt.ts                  fetchConfig, fetchGantt, errorMessage
  src/components/GanttChart.tsx     the chart: virtualized rows, calendar header, bars, today line, tooltip
  src/components/TaskList.tsx       list side of a row (name, chevron, tree lines) and the bar tooltip
  src/utils/flatten.ts              visible rows of the tree (parent before children), closed items filter
  src/utils/timeline.ts             time scale: view modes, columns, date → x, header labels
  src/utils/period.ts               period presets, range filtering and bar clipping
  src/utils/health.ts               health status flag of a row (own or from below), messages
  src/utils/overrun.ts              how far a row ends past its parent's end (red hatch)
  src/types/gantt.ts                TypeScript model (mirror of internal/model)
  e2e/                              Playwright tests (config in frontend/playwright.config.ts)
  src/**/*.test.ts                  Vitest unit tests (config in frontend/vitest.config.ts)
  e2e/largeTree.ts                  production-sized dataset (~16,000 rows) for large.mocked.spec.ts
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
cd frontend && npm run test:unit            # Vitest unit tests of src/utils (TZ=Europe/Paris)
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
- `GET /api/gantt` → `GanttTask[]` tree of the configured group. `?refresh=1` waits for fresh data. Headers `X-Cache: HIT|STALE|MISS` and `X-Fetched-At` (RFC 3339, when the data was fetched from GitLab: the toolbar's "Updated at"). Errors: 401 (token), 404 (group not found), 502 (other GitLab error), body `{"error": "..."}`. Every work item row carries its `labels` (`[{title, color}]`), on every copy; `noStartDate` / `noDueDate` are set on rows whose date is missing in GitLab. `health` (own GitLab health status) and `healthBelow` (`{atRisk, needsAttention}`, open descendants, omitted when none): see invariant 10. `noChildren` on open epics and milestones without any child item: see invariant 11. `blockedBy` / `blocking` (`[{id, name, webUrl, start, end, closed, noStartDate, noDueDate, external}]`) on work item rows with GitLab blocking links: see invariant 12.
- `GET /api/labels` → `[{title, color}]`: labels of the group and of its ancestors (`includeAncestorGroups`), sorted by title. Same `refresh`, headers, errors and token-fingerprinted cache as `/api/gantt`. Separate on purpose: a large hierarchy has thousands of labels (4,205 for `gitlab-org`, 43 pages, ~27 s), so the frontend never waits for it. Project labels aren't in it: the frontend adds the labels found on the items.

- **Cache** (`internal/cache`, used by both endpoints through `serveCached`): responses are cached **encoded** (JSON bytes, marshaled once). Up to 5 min old → `HIT`; up to 24 h → served at once as `STALE` while a background fetch refreshes them; older → dropped. Requests for a key share **a single fetch** (no pile-up of full GitLab walks when many users refresh), and the fetch runs on its own context (10 min timeout), **not the request's**: a closed tab or a proxy timeout doesn't waste it, its result is cached. Errors are not cached. At startup, with `GITLAB_TOKEN` set, `main` prefetches both keys. Work items and milestones are fetched in parallel. Each gantt fetch logs its item/row counts, JSON size and duration.
- A production-sized group (≈5,000 items) is ≈16,000 rows with the copies (invariants 2 and 9) and ≈4 MB of JSON; building the tree takes ≈20 ms. The copies grow with the depth: the deep worst case (`deepGroup()`, 12,900 items on 5 levels of epics) is 86,270 rows, ≈19 MB of JSON, ≈80 ms (`go test -run xxx -bench 'BuildGanttTree|BuildDeepGroup' ./internal/gitlab`). nginx gzips `/api/` responses and waits up to 300 s for the backend (`proxy_read_timeout`, for a cold fetch).

## GitLab GraphQL pitfalls (learned the hard way)

- Widgets are identified by **`__typename`** (`WorkItemWidgetHierarchy`, `WorkItemWidgetMilestone`, `WorkItemWidgetStartAndDueDate`). The `type` field returns an enum value (`HIERARCHY`…): don't use it to discriminate.
- The **`Milestone` type has no `webUrl`**, only `webPath`: the absolute URL is rebuilt by `absoluteURL` in `client.go`.
- `group.workItems` needs **`includeDescendants: true`** to include issues from the group's projects.
- Pagination: `afterCursor` must be **`null`** (not `""`) on the first page.
- GraphQL errors come back as HTTP 200 with `errors[]`: they are surfaced as-is.
- **Any query change must be validated against the real GitLab** (the `@live` test, or a `curl` to `https://gitlab.com/api/graphql` with a public group such as `gitlab-org`). A local mock once accepted a field that doesn't exist.
- Many items have no dates (`startDate`/`dueDate` are `null`): that's expected, see fallback dates below.
- Labels come from `WorkItemWidgetLabels { labels { nodes { id title color } } }` (`color` is a hex string; items carry both `GroupLabel` and `ProjectLabel` nodes).
- gitlab.com answers "Request timed out. Please try a less complex query or a smaller set of records." for `workItems` on huge groups (`gitlab-org`, `gitlab-com/gl-infra`), with or without the labels fragment. Validate query changes on a mid-size public group such as `gitlab-org/ruby` or `gitlab-org/security-products`.
- The health status comes from `WorkItemWidgetHealthStatus { healthStatus }` (`onTrack` / `needsAttention` / `atRisk`, `null` when unset; validated on `gitlab-org/ruby`). Paid-tier like the weight (same caveat below). Its `rolledUpHealthStatus` is not used: the counts here skip closed items and also cover milestones (invariant 10).
- The weight comes from `WorkItemWidgetWeight { weight }` (`null` when unset). Weights are a paid-tier feature: on an instance whose schema lacks that type (e.g. GitLab CE), the fragment may make the whole query fail — run the `@live` test when targeting a new instance. GitLab's own `rolledUpWeight` / `rolledUpCompletedWeight` are not used: they sum the weights of the leaves (and ignore unweighted items), while progress here is a weighted mean level by level.

- Blocking links come from `WorkItemWidgetLinkedItems`, queried twice under aliases: `blockedBy: linkedItems(filter: BLOCKED_BY, first: 50)` and `blocking: linkedItems(filter: BLOCKS, first: 50)`, nodes `{ workItemState workItem { id title webUrl widgets(onlyTypes: [START_AND_DUE_DATE]) { … } } }` (fragment `LinkedNodes on LinkedWorkItemTypeConnection`; validated on `gitlab-org/ruby` and `gitlab-org/security-products`). `BLOCKS` is needed too: an item of the group may block an item outside it. The linked item can be in **another group**; its dates come from the nested `widgets` — keep `onlyTypes`, without it every linked item brings its ~26 widgets. The `linkType` field (`relates_to` / `blocks` / `is_blocked_by`) isn't needed with the filters. Blocking links are paid-tier (same caveat as the weight). They add roughly 30–50 % to each work items page. More than 50 links on one item are cut.
## `tree_builder.go` invariants

Covered by `tree_builder_test.go` — any behavior change must come with a test.

1. **Two phases**: index nodes and child lists, then materialize recursively. Don't go back to copying structs on the fly (grandchildren used to get lost).
2. **Multiple placements, unique IDs**: an item can be shown several times. Its canonical placement (under its hierarchy parent, or as a root, or under its milestone when it has no parent) keeps the GitLab ID. Every extra copy, **and its whole subtree**, gets a suffix naming the placement and the item the copy is rooted at (`lastSegment` of its GID): `_ms_<id>` for the copy under a milestone, `_root_<id>` for the top-level copy of an epic. IDs must stay unique across the whole tree (the UI requires it; tests check it through `mustBuild`) and deterministic (the UI keys its expanded state on them). The frontend adds a third suffix, `_top`, when the filters list an issue at the top level (see Filters); `canonicalId` (`utils/filters.ts`) strips `_ms_`/`_root_` to recognize copies, so keep both in sync.
3. A hierarchy parent **missing** from the data doesn't count: the item becomes a root (or goes only under its milestone, without suffix).
4. **Deterministic order**: milestones sorted by start date then title, then roots in API order, then the epic top-level copies in depth-first order of the canonical tree. Never iterate over a map to produce output.
5. **Progress = weighted mean of the direct children** (`weightedProgress`): an item with children is at Σ(child weight × child progress) ÷ Σ(child weight), level by level; its own state is ignored. A child's weight is its own GitLab `weight` (epic or issue), or **1** when it has none (an explicit 0 counts as 0; if every child weighs 0, plain mean). A leaf is 100 when closed, 0 otherwise. A milestone is the weighted mean of its items; an empty milestone is 0. Examples: a feature with 2 issues of 5 points, one closed → 50%; a capability with 3 unweighted features at 50%, 0%, 0% → 16.67%.
6. **Linear progress** (`linearProgress`, on every row including milestones): the progress expected today if the work advanced evenly over the row's **own** dates — `(now − start) ÷ (end − start)`, clamped to 0–100 (`linearProgress()`, dates at 00:00 in the server's time zone). It is *not* aggregated from the children. Comparing it with `progress` says whether a row is ahead or behind. It means nothing when a date is missing in GitLab (made-up dates, see 7): the UI ignores it for those rows.
7. **Fallback dates** (`fallbackDates`, work items and milestones alike): no dates → **today only** (today → tomorrow), just so the row shows; due date only → due −14 d; start only → start +14 d. Always `end > start` (otherwise `start + 1 d`). A missing date is flagged with `noStartDate` / `noDueDate` so the UI can say the dates are made up.
8. **Milestones are matched by title** (`milestoneKey`): a milestone's children are the work items (epics or issues) whose `milestone { title }` equals its title, each with its subtree. Milestones sharing a title (group and projects) make one row, which keeps the ID, dates and URL of the first one registered — group milestones (`FetchGroupMilestones`) are registered first and shown **even when empty**; milestones found only through widgets (e.g. inherited from a parent group) are added after them.
9. **Every epic is also listed at the top level**: an epic that isn't already a root (it has a parent, or sits only under a milestone) gets a `_root_<id>` copy at the top level, with its subtree. Only epics are copied, not issues.
10. **Health status** (`extractHealth`, `model.HealthCounts`): `health` is the item's own GitLab status on every copy. `healthBelow` counts the **open** descendants at risk / needing attention, each item once (nil, so omitted, when 0/0): summed from the children in `materialize` (the hierarchy is a tree, copies get the same counts); for a milestone, `milestoneHealth` walks its items and their subtrees with a `seen` set, since an item and its ancestor can both be in the milestone. A closed item doesn't count itself but still passes on its descendants' (`openHealth`).
11. **Items without children** (`noChildren`): set on an **open epic** without any hierarchy child in the data (closed children count; taken from the child lists, not `task.Children`, so a child dropped by the cycle guard still counts; every copy gets it) and on an **open milestone** without any item. Issues never get it. It comes from the backend because the frontend's filters (closed items hidden, period) remove children: an epic whose children are all hidden isn't empty.

## Security
12. **Blocking links** (`extractLinks`, `model.DependencyRef`): `blockedBy` / `blocking` on every row of a work item (every copy; milestones never), in API order without duplicates, computed once every item is indexed. The `id` is the GitLab GID, never suffixed. A linked item **in the data** is described from it (its name, fallback dates, state); any other is `external`, described from the link (`workItemState`, nested dates through `fallbackDates`). Links don't change IDs (the deep tree SHA stays).

- The cache key includes a token fingerprint (`tokenFingerprint`, `ganttKey` / `labelsKey` in `main.go`). **Never key the cache on the group alone**: a tree fetched with one user's permissions would be served to another.

## Frontend

- **Design system** (Apple Human Interface Guidelines, transposed to the web): system font stack, Apple system colors, light **and dark** appearances following the system, hairline separators, translucent toolbar, rounded card, short motion disabled under `prefers-reduced-motion`. Everything lives in `src/styles/theme.css` as CSS variables (`--card`, `--text-secondary`, `--epic`, `--epic-band`…); use them instead of hard-coded colors. No external font or CSS framework: the app must work offline.
- **Appearance** (like Apple's setting): **Automatic** (follows the system), **Light** or **Dark**, picked from the toolbar's `AppearanceMenu` and remembered in `localStorage` (`nornir.appearance`). `useAppearance()` (`utils/appearance.ts`) resolves it and sets `data-theme="light|dark"` on `<html>`; `theme.css` holds the dark palette in a single `:root[data-theme='dark']` block (no `prefers-color-scheme` media query in the CSS). A small inline script in `index.html` applies the same resolution **before the first paint** to avoid a flash — keep it in sync with `resolveScheme`.
- Nested `backdrop-filter` doesn't blur what's outside its parent: anything floating inside the translucent toolbar (e.g. the appearance menu) needs a near-opaque background (`--menu-bg`).
- **The chart is ours, in plain HTML/CSS** (`GanttChart.tsx`), built for groups of thousands of items: **only the rows on screen are rendered** (plus `OVERSCAN_ROWS` above and below), and only the calendar columns on screen. **Never render every row**: a production group is ≈16,000 rows. One native scroll container (`.gantt-scroll`) holds a canvas as large as all rows × all columns; each row (`.gantt-row`) is absolutely placed at `index × ROW_HEIGHT` (40 px). The calendar header (`.gantt-header`, 52 px) is `position: sticky; top: 0`; the list side of each row (`.task-list-row`, 260 px) is `position: sticky; left: 0` and opaque, the bars scroll under it. The scroll position is read once per frame (`requestAnimationFrame`) into `viewport`, which picks the rows and columns to render; rows are `memo`ized.
- **Time scale** (`utils/timeline.ts`): columns of fixed width (`COLUMN_WIDTHS`: Day 44, Week 110 starting on Monday, Month 180); a date's position inside its column is proportional to the time elapsed in it (`makeTimeline(…).x(date)`). The timeline spans the period, or else **every item of the tree, collapsed ones included** (`dataSpan`) plus half a screen of columns around it and today — so expanding a row never moves the view. When its start moves anyway (closed items shown, filters, refresh), the layout effect in `GanttChart` shifts `scrollLeft` by the same amount so the dates on screen stay put. `ViewMode` (`Day` / `Week` / `Month`) is defined there too.
- **Colors are CSS only**: a bar carries `data-type`, `data-group`, `data-schedule`, `data-closed`, `data-undated`, `data-nested`, and `theme.css` sets its `--bar` color from them; `data-nested` (below the top level) tones it down with `color-mix(… 65%, var(--card))`. No color value lives in TypeScript.
- Layout: `App` = `Toolbar` (title, group, last update, `PeriodControl`, `SegmentedControl` for Day/Week/Month, Closed, Today, Refresh, Appearance) + error banner + `FilterBar` + `Legend` + skeleton / empty state (`StateViews.tsx`) + `GanttChart`. The view mode lives in `App`; `GanttChart` exposes `scrollToToday()` through a ref.
- **Full height**: the chart card grows with its rows, down to the window bottom at most; beyond that its rows scroll inside it while the calendar header stays in view. `#root` is a flex column at least `100dvh` tall and `.content` has `flex: 1 1 0px` (**not** `flex: 1`: a `0%` basis falls back to the content size in an auto-height column, so `.content` would follow the card instead of the window). `GanttChart` measures the room from the card's top to the bottom of `.content` (`ResizeObserver` on `.content`, floor `MIN_CARD_HEIGHT` 320px, below which the page scrolls) and sets it as the scroll container's `max-height`, in a layout effect (before the first paint) and starting from the window height: **the scroll container must never be unbounded**, or it would be as tall as every row and render them all (1.5 s with 5,000 top-level rows). The row window is also capped at the window height.
- `visibleRows(tree, expanded)` (`utils/flatten.ts`) lists the rows shown, each parent before its children, with their `depth`, `isLast`, `guides` (vertical tree lines to draw) and `parentType`. It only descends into **expanded** rows: its cost follows what is shown, not the tree size.
- Any item with children is a collapsible group (chevron); milestones are groups even when empty (schedule color, 3 layers) but only show a chevron when they have children. Everything starts **collapsed**: `GanttChart` only tracks the `expanded` set, so groups that appear after a refresh are collapsed too. `App` keeps the chart mounted during a refresh so expanded rows survive it.
- `YYYY-MM-DD` dates are parsed in **local** time (`parseDay`), not with `new Date(iso)` (UTC).
- The list and the bar tooltip are in `components/TaskList.tsx` (`TaskListRow`, `TooltipContent`): the list shows only the item names; the dates are in the tooltip ("From … to …", the real dates even when the bar is cut by the period). The e2e tests rely on the row structure: `.task-list-row` > cell `div[title=name]` containing the chevron `button` named **Expand** / **Collapse** (with `aria-expanded`). Don't put a `title` attribute on anything else named after an item.
- The tooltip (`.gantt-tooltip` in a fixed `.gantt-tooltip-anchor`) shows on hovering a bar, including its label (a child of `.bar`), and hides on scroll.
- **Membership of expanded rows**: the list draws CSS tree connectors (`.tree-guide`, `.tree-branch`); a row inside an expanded group is tinted with the parent's color (`--row-tint` = `var(--epic-band)`…, from `data-parent-type` on `.gantt-row`) on both sides — list and timeline — as a background layer (`--row-layers`, over the opaque row background). Row attributes `data-depth`, `data-parent-type`, `data-expanded` are used by CSS and tests.
- **Today line**: `.today-line` in the chart body at today's exact position (`timeline.x(now)`), with a "Today" pill (`.today-pill`) in the calendar header. None when today is outside the timeline.
- **Centering on today**: when the chart appears, after each view-mode change, on a period change (when the period holds today; otherwise the timeline scrolls to the period start) and on **Today** (`centerOnToday`: sets `scrollLeft` directly).
- **Schedule status colors**: epic and milestone bars (and their linear layer, and the tooltip's status and progress bar) are colored by `scheduleStatus` (`utils/schedule.ts`): **green** on track (`progress ≥ linearProgress`), **orange** up to `SCHEDULE_THRESHOLD` = 5 percentage points behind, **red** beyond. Issues keep their type color, which is **teal**, not green, so that green only ever means "on track". List rows of groups carry `data-schedule`.
- **Filters** (`FilterBar`, `FilterMenu`, `utils/filters.ts`) pick **which items to show**: a Search field, the **Show** toggles **Milestones** / **Epics** / **Issues** (`aria-pressed`; all pressed by default, `DEFAULT_FILTERS`; none pressed = nothing matches), the **Health** pop-up menu (`HEALTH_OPTIONS`: At risk, Needs attention, On track; an item matches on its **own** status, a milestone when one of its open items does, `hasHealth`) and the **Labels** pop-up menu (checkable `option`s in a `dialog` popover, a search field inside once there are `SEARCH_THRESHOLD` = 8 options or more). Rules, in `applyFilters`: without any filter (all types pressed, no label, no search: `isFiltering`), the tree as is. Otherwise a **flat list** of the items whose type is pressed, that carry **any** selected label, whose health status is **any** of the selected ones, and whose name contains the search (ignoring case and accents, `normalizeText`) — the four are ANDed. Order: milestones (top-level rows), epics (their top-level row: the tree has exactly one per epic, root or `_root_` copy), then issues (depth-first, first occurrence per `canonicalId`, copied with the `_top` suffix on its whole subtree so the IDs stay unique when their epics are listed too). Every listed item keeps **its whole content**. Milestones have no labels: with labels selected, a milestone matches when one of its descendants carries one. Pipeline in `App`: `data → withoutClosed → withinPeriod → applyFilters → GanttChart`, the filters go through `useDeferredValue`, and they aren't remembered across reloads. Milestone and epic IDs don't change when filtering, so expanded rows stay expanded. `GanttChart` **stays mounted while the filters match nothing** (it renders nothing then, and `App` shows "No matching items" with **Clear filters**). The Labels menu lists "In this chart" labels (found on the rows, which includes project labels) then "Other labels" from `/api/labels` (`labelOptions`). `/api/labels` loads in the background; a failure is ignored.
- **Period** (`PeriodControl` in the toolbar, `utils/period.ts`): presets **This quarter** / **This year** (default) / **3 years** (Jan 1 last year → Dec 31 next year) / **All dates**, plus ‹ › (`Previous period` / `Next period`, disabled for All) moving by one quarter or one year (`Period.offset`). Only the preset is remembered (`localStorage` `nornir.period`, `useStoredValue` in `utils/preferences.ts`); **Today** resets the offset. Picking a preset switches the view mode (`PERIOD_PRESETS[].viewMode`: Week for a quarter, Month otherwise). Pipeline in `App`: `data → withoutClosed → withinPeriod → applyFilters → GanttChart`. `withinPeriod` keeps a node when its own dates overlap the range **or** one of its descendants is kept (IDs unchanged). With a range, the timeline spans exactly the period and `GanttChart` cuts bars at it with `clipBar`, which converts `progress` / `linearProgress` from positions along the real dates into fractions of the cut bar; the tooltip shows the real dates. On a period change the chart centers on today when the period holds it, otherwise it scrolls to the period start. An empty period shows "Nothing in this period" with **Show all dates**.
- **Closed items filter**: hidden by default; the toolbar's **Closed** toggle (`aria-pressed`) shows them. `withoutClosed` (`utils/flatten.ts`) drops closed nodes **with their subtree** before the tree reaches `GanttChart`; it is purely visual (progress values from the backend still include closed items). The choice is remembered in `localStorage` (`nornir.showClosed`, `useStoredBoolean` in `utils/preferences.ts`). When everything is closed, the empty state offers **Show closed items**.
- **Closed rows** (`closed` from the backend: work item `state = CLOSED`, milestone `state = closed` — the milestone queries request `state`): drawn as one full bar with a gray hatch (`repeating-linear-gradient` of `--closed-bg` / `--closed-stroke` on `.bar[data-closed] .bar-track`), no progress, no schedule color, no linear layer, grayed label; the tooltip shows the real progress and says "Closed". List rows get `data-closed` too (grayed name and dot).
- **Health status** (`utils/health.ts`, `HealthBadge` in `Icons.tsx`): SF Symbols-style SVG icons, `span.health` (`role="img"`, `aria-label` + `title` from `healthMessage`, `data-level="atRisk|needsAttention"`): **red octagon** (`exclamationmark.octagon.fill`, at risk) and **orange circle** (`exclamationmark.circle.fill`, needs attention), white exclamation mark; the shape (`.health-shape`: `path` vs `circle`) tells them apart without color. In the list only, in the row's **trailing accessories** (`.row-accessories`, pushed to the end of `.task-list-cell` like a macOS / iOS table cell, so they line up from row to row; the missing-dates warning goes there too); **not on the bars** (the list is always visible on the same row). The user asked for Apple-like, uncluttered marks: text glyphs ("!!" in a capsule) and icons on the bars were tried and dropped. **One icon everywhere**, whether the status is the row's own or comes from `healthBelow` — the help tag tells which (the user found two styles confusing); at risk beats needs attention; on track and closed rows get none (`rowHealth`). Rows and bars carry `data-health`. **No outline around the bars**: it was tried and dropped as too heavy, the icon is enough. Legend: a Health group (the icon and its label). `HealthBadge` without `label` is decorative (`aria-hidden`). It never touches `--bar`: orange/red bars mean the schedule, the health status has its own tokens (`--health-at-risk`, `--health-needs-attention`, `--health-on-track`). The tooltip adds "Health: …" (own status, on track included) and "Below: 1 at risk · 2 need attention", each after its 12 px icon (none for on track).
- **Planned past the parent** (`utils/overrun.ts`): `overrun(node, row.parent)` — the parent is the row it is **shown under** (`Row.parent`, set by `visibleRows`: its epic, or its milestone), so each copy is judged against its own parent and top-level rows (filtered flat lists included) never are. Only the **end** counts (starting before the parent isn't flagged); none for closed rows or when either due date is made up (`noDueDate`). `Bar` draws `.bar-overrun` (red hatch, `--overrun`) from the parent's end to the row's end, both cut at the bar's clipped dates (period), in pixels; `.bar` gets `data-overrun`. The tooltip adds "Ends N days after <parent>" (`.overrun-note`, real days even when cut). Frontend only: computed for the rows on screen. Legend: "Past its parent".
- **Row warnings** (`rowWarnings` in `utils/schedule.ts`, one message per line): **one** orange warning sign at the end of the row (`span.row-warning` in `.row-accessories`, `WarningFillIcon`, SF Symbols' `exclamationmark.triangle.fill`; `role="img"`, `aria-label` = messages joined by ". ", native `title` = messages joined by a newline, one line each), and one `.warning-note` line per message in the bar tooltip. Messages, in order: the missing dates (below), then **no child items** (`noChildrenMessage`, from the backend's `noChildren`: epic "No child items: progress can't be tracked (stays at 0% until closed)", milestone "No items: progress can't be tracked (stays at 0%)"; not for closed items). A row without children gets `data-empty` and **no schedule status** (`rowSchedule`): its 0% means nothing.
- **Missing dates** (`noStartDate` / `noDueDate`, message from `missingDatesMessage` in `utils/schedule.ts`: "No dates in GitLab", "No start date in GitLab", "No due date in GitLab"): shown by the row warning sign (above) and the row gets `data-undated`; the bar (`data-undated`) is gray (`--undated`) with a **gray** dashed outline inside it (`--undated-stroke`), no schedule color, no linear layer, no `data-schedule`. The bar tooltip shows the message instead of "Expected…". A closed row keeps its hatch (no outline) but still shows the warning sign. Legend: "No dates".
- **Linear progress layer**: group bars (epics, milestones, any item with children) show 3 layers: the transparent track (`.bar-track`, opacity 0.3), the linear progress (`.linear-progress`, opacity 0.55) and the solid real progress (`.bar-progress`). Leaf bars are solid, their progress a darker overlay. The tooltip of a group shows "Expected N% · X% ahead/behind" (`scheduleStatus`).
- Error messages: `errorMessage` (in `api/gantt.ts`) shows the backend's `error`, or a plain-language message when the backend doesn't answer (nginx 502/503/504). nginx's `proxy_connect_timeout` is 5 s so this shows up quickly.
- Double-clicking a bar opens the item in GitLab.

## Tests

- **Frontend unit tests** (Vitest, `vitest.config.ts`): `src/**/*.test.ts`, next to the pure logic of `src/utils` (filters, health, overrun, period, schedule, flatten); `task()` in `src/utils/testing.ts` builds tree nodes. `npm run test:unit` runs them with `TZ=Europe/Paris` so date code meets a daylight saving change. They are type-checked by `npm run build` (`tsc` includes `src`). Add one for any new pure function; keep DOM and layout checks in Playwright.
- **Go**: unit tests in `backend/internal/gitlab` (`buildGanttTree` takes an injected `now` to stay deterministic), `internal/cache` (shared fetch, stale data, cancelled requests; run with `-race`) and `cmd/server` (handlers against an `httptest` fake GitLab).
- **Playwright**: in `frontend/e2e/` — **every new Playwright test is saved in the project**, never thrown away.
  - `*.mocked.spec.ts`: API mocked with `page.route`, datasets in `e2e/fixtures.ts` (`mockApi`, with an optional `delayMs`).
  - `large.mocked.spec.ts` (load tests, datasets in `e2e/largeTree.ts`): the production-sized `largeTree()` (~16,000 rows), `manyEpicsTree()` (5,200 top-level epics of 2 to 5 issues, ~23,000 rows) and the worst case `deepTree()` (5 levels of epics under milestones, copies of every subtree: 86,270 rows on 7 levels, ~24 MB) must show in under 3 s, keep fewer than 100 list rows in the page (also at the bottom, and with every issue listed flat by the Issues filter), and expand / search / filter in under 1–2 s. Rows are virtualized: **a row off screen is not in the page** — scroll to it before asserting on it, and don't expect `toHaveCount` on rows below the fold.
  - `deepTree()` applies the rules of `tree_builder.go` to the same work items as `deepGroup()` in `backend/internal/gitlab/tree_builder_deep_test.go`; both check the tree's IDs against the same SHA-256 (`DEEP.sha256` / `deepTreeSHA256`). **If the tree builder changes, both must be updated together.** The load tests run one at a time in a single worker (`test.describe.configure({ mode: 'default' })`): in parallel, browsers parsing tens of MB compete for the CPU and the timings flake. Don't call `expect` per row on these datasets (86,270 calls take minutes): collect, then assert once.
  - Chart selectors: bars are `.bar` (with the `data-*` above) holding `.bar-track`, `.linear-progress`, `.bar-progress` and `.bar-label`; colors are read with `getComputedStyle` (`toHex` in `gantt.mocked.spec.ts` also reads the `color(srgb …)` that `color-mix()` computes to). Calendar columns are `.calendar-cell`, the scroll container `.gantt-scroll`.
  - The default period is **This year**, relative to the real clock: `gantt.mocked.spec.ts` and the `@live` tests store `nornir.period = all` in a `beforeEach` (`page.addInitScript`) so they don't depend on the date. `period.mocked.spec.ts` tests the period with a fixed clock and the `periodTree` dataset. Selectors: buttons **Previous period** / **Next period**, the menu button named `Period: <label>` (`2026`, `Q4 2026`, `2025 – 2027`, `All dates`) and its `menuitemradio`s.
  - Helpers that read the DOM once (`listRows`, `barFill`, `todayLinePosition`…) don't retry: after an action (expand, view change), wait with a web-first assertion (`toBeVisible`, `expect.poll`) for the expected state before calling them — otherwise the test is flaky under load.
  - Selectors use roles and labels: chevrons are buttons **Expand** / **Collapse**, view modes are `radio`s (**Day**, **Week**, **Month**, `aria-checked`), **Today** and **Refresh** are buttons, errors are `role="alert"`. Filters: textbox **Search**, `group` **Show** with the toggle buttons **Milestones** / **Epics** / **Issues** (`aria-pressed`), button **Labels** (named `Labels: backend`, `Labels: 2 labels` once set, `data-active`), popover `dialog` named like its button, holding `option`s (`aria-selected`) named by their label; **Clear** in the bar, **Clear filters** in the empty state. `mockApi(page, gantt, labels)` also mocks `/api/labels`. Health: `health.mocked.spec.ts` on the `healthTree` dataset; the menu button is named `Health`, `Health: At risk`, `Health: 2 statuses`; icons are `.health` (`data-level`, `aria-label`, `.health-shape`). Row warnings: `warnings.mocked.spec.ts` on `warningTree` (`.row-warning` `title` / `aria-label`, `.warning-note`). Overrun: `overrun.mocked.spec.ts` on `overrunTree`, measuring `.bar-overrun` against the parent's bar and a Day column read from the DOM. Read sizes from the DOM (row height, today's column width) rather than hard-coding them.
  - Dark mode: `page.emulateMedia({ colorScheme: 'dark' })` (system appearance, used by Automatic), or pick **Light** / **Dark** in the **Appearance** menu (`menuitemradio`); the button exposes the choice as `data-appearance`.
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
2. `cd frontend && npm run build && npm run test:unit && npm run test:e2e:mocked` (against a fresh build — see Tests)
3. If the GitLab client or GraphQL queries changed: `npm run test:e2e` (includes `@live`) with the stack running.

### Documentation

- **Update `README.md`** for any user-visible change: configuration, commands, application behavior.
- **Update this `AGENTS.md`** whenever a new convention, pitfall, invariant, command or known limitation appears — or when something here becomes wrong.
- Documentation updates go **in the same commit** as the change they describe.

### Style

- Code comments are in English and concise; follow the surrounding style.
- Go formatted with `gofmt`. TypeScript in `strict` mode.

## Known limitations / ideas

- Items without dates (made up: today → tomorrow) only show in periods that contain today.
- **Refresh** on a large group waits for a full GitLab walk (minutes for thousands of items); the chart stays usable meanwhile. Stale data served from the cache isn't reloaded automatically once the background fetch completes: the next load or refresh gets it.
- Labels menu: with thousands of group labels, the popover renders them all when opened (not virtualized).
- An item without dates but attached to a milestone doesn't inherit the milestone's dates.
- A cycle in the hierarchy (A parent of B, B parent of A) makes the involved items disappear.
