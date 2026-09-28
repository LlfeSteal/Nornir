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
  src/utils/period.ts               period presets, range filtering and bar clipping
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
- `GET /api/gantt` → `GanttTask[]` tree of the configured group. `?refresh=1` bypasses the cache. Header `X-Cache: HIT|MISS`. Errors: 401 (token), 404 (group not found), 502 (other GitLab error), body `{"error": "..."}`. Every work item row carries its `labels` (`[{title, color}]`), on every copy; `noStartDate` / `noDueDate` are set on rows whose date is missing in GitLab.
- `GET /api/labels` → `[{title, color}]`: labels of the group and of its ancestors (`includeAncestorGroups`), sorted by title. Same `refresh`, `X-Cache`, errors and token-fingerprinted cache as `/api/gantt`. Separate on purpose: a large hierarchy has thousands of labels (4,205 for `gitlab-org`, 43 pages, ~27 s), so the frontend never waits for it. Project labels aren't in it: the frontend adds the labels found on the items.

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
- The weight comes from `WorkItemWidgetWeight { weight }` (`null` when unset). Weights are a paid-tier feature: on an instance whose schema lacks that type (e.g. GitLab CE), the fragment may make the whole query fail — run the `@live` test when targeting a new instance. GitLab's own `rolledUpWeight` / `rolledUpCompletedWeight` are not used: they sum the weights of the leaves (and ignore unweighted items), while progress here is a weighted mean level by level.

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

## Security

- The cache key includes a token fingerprint (`tokenFingerprint` in `main.go`). **Never key the cache on the group alone**: a tree fetched with one user's permissions would be served to another.

## Frontend

- **Design system** (Apple Human Interface Guidelines, transposed to the web): system font stack, Apple system colors, light **and dark** appearances following the system, hairline separators, translucent toolbar, rounded card, short motion disabled under `prefers-reduced-motion`. Everything lives in `src/styles/theme.css` as CSS variables (`--card`, `--text-secondary`, `--epic`, `--epic-band`…); use them instead of hard-coded colors. No external font or CSS framework: the app must work offline.
- **Appearance** (like Apple's setting): **Automatic** (follows the system), **Light** or **Dark**, picked from the toolbar's `AppearanceMenu` and remembered in `localStorage` (`nornir.appearance`). `useAppearance()` (`utils/appearance.ts`) resolves it and sets `data-theme="light|dark"` on `<html>`; `theme.css` holds the dark palette in a single `:root[data-theme='dark']` block (no `prefers-color-scheme` media query in the CSS). A small inline script in `index.html` applies the same resolution **before the first paint** to avoid a flash — keep it in sync with `resolveScheme`.
- Nested `backdrop-filter` doesn't blur what's outside its parent: anything floating inside the translucent toolbar (e.g. the appearance menu) needs a near-opaque background (`--menu-bg`).
- The Gantt bars are SVG colored through props, so they need actual color values: `PALETTES` (`utils/colors.ts`) + the resolved scheme from `ColorSchemeContext` / `useColorScheme()` (`utils/appearance.ts`, provided by `App`) pick the light/dark palette; `muted()` tones down bars below the top level. Keep `PALETTES` in sync with the CSS variables.
- **gantt-task-react styles** are overridden at the end of `theme.css` using the library's hashed CSS-module class names (e.g. `._35nLX` = calendar header, `._2pZMF` = the project "ears", hidden). They are stable for the pinned version 0.3.9; **check them again when upgrading the library**. Lib props set in `GanttChart`: `rowHeight` 40 (`ROW_HEIGHT`), `headerHeight` 52, `barCornerRadius` 6, `barFill` 60, list width 260, `ganttHeight` measured (see Full height). `._1eT-t` = the library's vertical scrollbar, styled like the horizontal one (`._2k9Ys`).
- Layout: `App` = `Toolbar` (title, group, last update, `PeriodControl`, `SegmentedControl` for Day/Week/Month, Closed, Today, Refresh, Appearance) + error banner + `FilterBar` + `Legend` + skeleton / empty state (`StateViews.tsx`) + `GanttChart`. The view mode lives in `App`; `GanttChart` exposes `scrollToToday()` through a ref.
- **Full height**: the chart card grows with its rows, down to the window bottom at most; beyond that its rows scroll inside it (wheel, ↑/↓, the library's vertical scrollbar) while the calendar header stays in view. `#root` is a flex column at least `100dvh` tall and `.content` has `flex: 1 1 0px` (**not** `flex: 1`: a `0%` basis falls back to the content size in an auto-height column, so `.content` would follow the card instead of the window). `GanttChart` measures the room from the card's top to the bottom of `.content` (`ResizeObserver` on `.content`, floor `MIN_CARD_HEIGHT` 320px, below which the page scrolls) and passes `ganttHeight` = min(that room − `HEADER_HEIGHT` − horizontal scrollbar, visible rows × `ROW_HEIGHT`). **Never pass a `ganttHeight` taller than the rows**: the library would then scroll to a negative offset on the wheel or ↑/↓, which shifts its tooltip.
- `flattenGanttTree` yields a list where each parent precedes its children: `gantt-task-react` requires it.
- Any item with children (and every milestone) is a collapsible `project`; leaves are `task`s. Everything starts **collapsed**: `GanttChart` only tracks the `expanded` set, so groups that appear after a refresh are collapsed too. `App` keeps the chart mounted during a refresh so expanded rows survive it.
- `YYYY-MM-DD` dates are parsed in **local** time (`parseDay`), not with `new Date(iso)` (UTC).
- The list and the bar tooltip are our own components (`components/TaskList.tsx`, passed as `TaskListHeader` / `TaskListTable` / `TooltipContent`): the list shows only the item names; the dates are in the tooltip ("From … to …"). The e2e tests rely on the row structure: cell `div[title=name]` containing the chevron `button` named **Expand** / **Collapse** (with `aria-expanded`).
- Bar labels (`svg text`) don't receive pointer events: in tests, hover a bar by moving the mouse onto its label's bounding box.
- **Membership of expanded rows**: `flattenGanttTree` also returns each row's `depth`, `isLast`, `guides` (vertical tree lines to draw) and `parentType`; `GanttChart` passes them to the list through `RowInfoContext` (the library only hands its own `Task`s to `TaskListTable`). The list draws CSS tree connectors (`.tree-guide`, `.tree-branch`) and tints the rows inside an expanded group with the parent's color (`groupBand`); bars below the top level are toned down (`muted`). Row attributes `data-depth`, `data-parent-type`, `data-expanded` are used by CSS and tests.
- **Timeline bands**: `paintGroupBands` tints the grid rows (`g.rows rect`) of the rows inside an expanded group, from the same `MutationObserver` as the today line. The library draws one grid rect per task **including hidden ones**, at `y = index × ROW_HEIGHT`: the visible row *i* (from `visibleRows`) is the rect at `y = i × ROW_HEIGHT`. The band color is a CSS variable (`var(--epic-band)`…) set as inline `style.fill`.
- **Today line**: `gantt-task-react` can only fill today's whole column (`todayColor`, a whole week in Week view). We make that column transparent and `drawTodayLine` (in `GanttChart.tsx`) adds a `line.today-line` to the SVG at today's exact position inside the column (`columnFraction` in `utils/today.ts`). The library re-renders its SVG on its own, so a `MutationObserver` redraws the line.
- **Centering on today**: done by `keepTodayLineAt` (run for ~0.5 s by `startKeepingTodayLine`, one loop at a time), which scrolls the library's own horizontal scrollbar (the only `overflow-x: auto` div) to put the line in the middle, after the chart appears, after each view-mode change and on **Today**.
- **The view doesn't jump when the date range changes**: the library keeps its scroll in pixels, so when its range start moves (rows expanded, closed items shown, refresh), the dates on screen would shift. The draw loop notices the today line moving for the same view mode and keeps it at the same screen position (same `keepTodayLineAt`, with the previous offset). **Don't use the `viewDate` prop** for this: the library resolves it against stale columns when its date range changes in the same render (first render, collapsed rows), so the scroll lands in the wrong place. `preStepsCount` is sized so the range starts at least half a screen before today, even when every item is in the future.
- **Schedule status colors**: epic and milestone bars (and their linear layer, and the tooltip's status and progress bar) are colored by `scheduleStatus` (`utils/schedule.ts`): **green** on track (`progress ≥ linearProgress`), **orange** up to `SCHEDULE_THRESHOLD` = 5 percentage points behind, **red** beyond. Issues keep their type color, which is **teal**, not green, so that green only ever means "on track". List rows of groups carry `data-schedule`.
- **Filters** (`FilterBar`, `FilterMenu`, `utils/filters.ts`) pick **which items to show**: a Search field, the **Show** toggles **Milestones** / **Epics** / **Issues** (`aria-pressed`; all pressed by default, `DEFAULT_FILTERS`; none pressed = nothing matches) and the **Labels** pop-up menu (checkable `option`s in a `dialog` popover, a search field inside once there are `SEARCH_THRESHOLD` = 8 options or more). Rules, in `applyFilters`: without any filter (all types pressed, no label, no search: `isFiltering`), the tree as is. Otherwise a **flat list** of the items whose type is pressed, that carry **any** selected label, and whose name contains the search (ignoring case and accents, `normalizeText`) — the three are ANDed. Order: milestones (top-level rows), epics (their top-level row: the tree has exactly one per epic, root or `_root_` copy), then issues (depth-first, first occurrence per `canonicalId`, copied with the `_top` suffix on its whole subtree so the IDs stay unique when their epics are listed too). Every listed item keeps **its whole content**. Milestones have no labels: with labels selected, a milestone matches when one of its descendants carries one. Pipeline in `App`: `data → withoutClosed → withinPeriod → applyFilters → GanttChart`, the filters go through `useDeferredValue`, and they aren't remembered across reloads. Milestone and epic IDs don't change when filtering, so expanded rows stay expanded. `GanttChart` **stays mounted while the filters match nothing** (it renders nothing then, and `App` shows "No matching items" with **Clear filters**). The Labels menu lists "In this chart" labels (found on the rows, which includes project labels) then "Other labels" from `/api/labels` (`labelOptions`). `/api/labels` loads in the background; a failure is ignored.
- **Period** (`PeriodControl` in the toolbar, `utils/period.ts`): presets **This quarter** / **This year** (default) / **3 years** (Jan 1 last year → Dec 31 next year) / **All dates**, plus ‹ › (`Previous period` / `Next period`, disabled for All) moving by one quarter or one year (`Period.offset`). Only the preset is remembered (`localStorage` `nornir.period`, `useStoredValue` in `utils/preferences.ts`); **Today** resets the offset. Picking a preset switches the view mode (`PERIOD_PRESETS[].viewMode`: Week for a quarter, Month otherwise). Pipeline in `App`: `data → withoutClosed → withinPeriod → applyFilters → GanttChart`. `withinPeriod` keeps a node when its own dates overlap the range **or** one of its descendants is kept (IDs unchanged). `GanttChart` cuts bars at the range with `clipBar`, which converts `progress` / `linearProgress` from positions along the real dates into fractions of the cut bar (`barLinear` feeds `paintLinearProgress`); the tooltip reads the real dates from `RowInfoContext`. With a range, `preStepsCount` = `preStepsTo(range.from, earliest visible bar start)` so the library's range starts with the period. **The library crashes (`taskXCoordinate` reads `dates[-1]`) when a bar starts exactly on its first date**: `preStepsTo` then adds a step, and one more for the Month-view day overflow (May 31 − 1 month = May 1). On a period change the chart centers on today when the period holds it, otherwise it scrolls to the period start (`scrollTimelineTo(…, 0)`); `lastLine` also tracks the period so this isn't taken for a range change to compensate. An empty period shows "Nothing in this period" with **Show all dates**.
- **Closed items filter**: hidden by default; the toolbar's **Closed** toggle (`aria-pressed`) shows them. `withoutClosed` (`utils/flatten.ts`) drops closed nodes **with their subtree** before the tree reaches `GanttChart`; it is purely visual (progress values from the backend still include closed items). The choice is remembered in `localStorage` (`nornir.showClosed`, `useStoredBoolean` in `utils/preferences.ts`). When everything is closed, the empty state offers **Show closed items**.
- **Closed rows** (`closed` from the backend: work item `state = CLOSED`, milestone `state = closed` — the milestone queries request `state`): drawn as one full bar filled with a gray hatch (`url(#nornir-closed-hatch)`, an SVG pattern rendered once by `ClosedHatchPattern`; the lib takes it as a color prop), no schedule color, no linear layer; `task.progress` is forced to 100 for the lib so the hatch covers the bar — the tooltip reads the real progress from `RowInfoContext` and says "Closed". `markBars` sets `data-closed` on the lib's task group so CSS grays the label; list rows get `data-closed` too (grayed name and dot).
- **Missing dates** (`noStartDate` / `noDueDate`, message from `missingDatesMessage` in `utils/schedule.ts`: "No dates in GitLab", "No start date in GitLab", "No due date in GitLab"): the list shows an orange warning sign after the name (`span.missing-dates`, `role="img"`, native `title` as its help tag) and the row gets `data-undated`; the bar is gray (`PALETTES.undated` / `--undated`), no schedule color, no linear layer, no `data-schedule`, and `markBars` sets `data-undated` on the lib's task group so CSS draws an orange dashed outline (`--warning`) on its background rect (`._31ERP` task, `._2RbVy` project). The bar tooltip shows the message instead of "Expected…". A closed row keeps its hatch (no outline) but still shows the warning sign. Legend: "No dates".
- **Linear progress layer**: epic and milestone bars (library "projects") show 3 layers: the transparent track (opacity 0.3, the library's `._2RbVy`), the linear progress (`rect.linear-progress`, opacity 0.55, added by `paintLinearProgress` right after the track from the same `MutationObserver`, matched to its row by `y`), and the solid real progress on top. Issue bars keep their plain look. The tooltip of a group shows "Expected N% · X% ahead/behind" (`scheduleStatus`).
- **Today pill**: `drawTodayPill` adds a "Today" label at the bottom of the calendar header SVG, above the line.
- Error messages: `errorMessage` (in `api/gantt.ts`) shows the backend's `error`, or a plain-language message when the backend doesn't answer (nginx 502/503/504). nginx's `proxy_connect_timeout` is 5 s so this shows up quickly.
- Double-clicking a bar opens the item in GitLab.

## Tests

- **Go**: unit tests in `backend/internal/gitlab` (`buildGanttTree` takes an injected `now` to stay deterministic).
- **Playwright**: in `frontend/e2e/` — **every new Playwright test is saved in the project**, never thrown away.
  - `*.mocked.spec.ts`: API mocked with `page.route`, datasets in `e2e/fixtures.ts` (`mockApi`, with an optional `delayMs`).
  - The default period is **This year**, relative to the real clock: `gantt.mocked.spec.ts` and the `@live` tests store `nornir.period = all` in a `beforeEach` (`page.addInitScript`) so they don't depend on the date. `period.mocked.spec.ts` tests the period with a fixed clock and the `periodTree` dataset. Selectors: buttons **Previous period** / **Next period**, the menu button named `Period: <label>` (`2026`, `Q4 2026`, `2025 – 2027`, `All dates`) and its `menuitemradio`s.
  - Helpers that read the DOM once (`listRows`, `barFill`, `todayLinePosition`…) don't retry: after an action (expand, view change), wait with a web-first assertion (`toBeVisible`, `expect.poll`) for the expected state before calling them — otherwise the test is flaky under load.
  - Selectors use roles and labels: chevrons are buttons **Expand** / **Collapse**, view modes are `radio`s (**Day**, **Week**, **Month**, `aria-checked`), **Today** and **Refresh** are buttons, errors are `role="alert"`. Filters: textbox **Search**, `group` **Show** with the toggle buttons **Milestones** / **Epics** / **Issues** (`aria-pressed`), button **Labels** (named `Labels: backend`, `Labels: 2 labels` once set, `data-active`), popover `dialog` named like its button, holding `option`s (`aria-selected`) named by their label; **Clear** in the bar, **Clear filters** in the empty state. `mockApi(page, gantt, labels)` also mocks `/api/labels`. Read sizes from the DOM (row height, today's column width) rather than hard-coding them.
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

- With a period, the timeline can't end exactly with it: the library pads after the last visible bar (+19 days in Day view, +1.5 months in Week view, up to the next Jan 1 in Month view), and stops earlier when the items do.
- Items without dates (made up: today → tomorrow) only show in periods that contain today.
- If today is after the end of every item (plus the library's padding: ~19 days in Day view, 1.5 months in Week view, the end of the year in Month view), there is no today line and no centering: the library can't extend its date range past the items.
- The library sizes its grid over all tasks, hidden ones included: the today line (like the grid) may extend below the last visible row, clipped by the SVG.
- The task list doesn't indent hierarchy levels (a `gantt-task-react` limitation).
- An item without dates but attached to a milestone doesn't inherit the milestone's dates.
- A cycle in the hierarchy (A parent of B, B parent of A) makes the involved items disappear.
