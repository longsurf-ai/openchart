# React charts

Open or create a **Dashboard** in the sidebar (`/app/dashboards/:dashboardId`).
An empty Dashboard creates no chart until you choose **Add chart**, search for a
symbol, and select a real provider result. One backend transaction creates the
Chart Resource and its Dashboard placement. All placements render as widgets;
outer drag/resize is always available on wide layouts without changing the chart's
inner CSS grid. The grip also accepts arrow keys to move. The X removes the widget placement while preserving its Chart Resource.

The page's upper-left symbol control edits the focused cell in the selected
Chart widget. It queries and mutates the Chart Resource independently of renderer
readiness. An open picker keeps its original chart/cell IDs until the save ends.
The Dashboard owns one transient selection shared by this control and the grids.

Each widget's centered floating controls contain interval (with session and
adjustment), chart type (with volume), compare, grid presets and links.
The controls remain mounted and appear on hover, keyboard focus and while their
menus/dialogs are open. ChartGridProvider shares the widget's mounted runtime
and preference handles and local maximize state. Chart Explain consumes the
application's shared Agent through `lib/agent`.

Each cell in a multi-cell grid has a subtle top-right maximize/restore icon.
It fills the containing widget while keeping the other cells mounted. There is
no Chart view menu, Series picker, Fit data, Go to latest or cell-delete action.
Smaller presets keep their hidden cells for reuse when expanding the grid again.

The drawing rail stays visible and floats over the chart. Drag its top handle
to move it within the widget; react-draggable owns its position and gestures.
Auto/Log and axis
settings stay beside their individual vertical axes, with A/L in a separate
hover/focus row above the compact settings buttons. A clock button opens the
display timezone menu from the bottom-right corner. Each pane has display-series
legends with OHLC and loading/error readouts. Click a name to replace its market
input; main retains the grid's symbol links, while comparisons keep their IDs.
Hover/focus reveals show/hide, shared series settings, remove and placement actions.
Native row selection locks the series; hover identifies its curve. Main cannot be
removed. Placement menus include Magnet, pane moves and independent left/right axes.
Price and volume legends share one Feed subscription; a binding's Resource
`output` decides which it is, and new cells start with volume over price. Styles apply immediately;
each indicator has one legend, anchored to its first declared output’s pane.
All output values appear inline with their current colors, including values from
other panes. Hide/show affects the whole indicator; the shared style dialog’s
Output selector edits individual outputs. One Series settings dialog contains Inputs
and Style tabs, using the same settings rows and shared form controls.
Placement moves the whole indicator to a pane or shared axis. Reload and removal
stay grouped. Market price tags reuse the core ticker badge with the displayed
listing symbol; volume tags stay numeric.
Style shows all output colors together and reads effective renderer values.
Only explicit edits are persisted; reset removes the override. Tea visual colors
take precedence over V1's theme-owned indicator palette, which supplies omitted
colors. Script `input.color` declarations remain computation inputs.
Display controls reuse the existing preferences. Shared dividers resize adjoining
cells; arrow keys, Home/End, Escape and pointer cancellation remain supported.
Grid ratios and display preferences survive reload.

## Running with real data

From the repository root, use Node 24 and `just desktop`. The existing public Providers are
registered but disabled until enabled in `settings.json` beside the application's
`openchart.sqlite3`:

```json
{
  "providers": {
    "binance": { "enabled": true },
    "yfinance": { "enabled": true }
  }
}
```

On macOS the development application uses
`~/Library/Application Support/OpenChart Development Mock/`. Existing configuration
fields should be retained when enabling Providers. Provider availability updates
without inventing replacement data. The packaged origin is `openchart://app`;
development ports have separate localStorage origins.

## Ownership

- `ChartCore` (`@openchart/app/chart`) owns one renderer and immutable ChartStore.
- The feature's `ChartCell` explicitly mounts MarketSource, IndicatorSource and
  DrawingSource as siblings inside ChartCore. It owns the legend target map;
  ChartPanes projects Resource pane structure independently of loading;
  ChartLegend only positions empty pane containers. Hiding legends does not
  stop sources or remove their chart visuals.
- The feature's `ChartGrid`, cells and controls subscribe to the same Query
  Resource directly. The Dashboard composes placements; it does not prepare chart data.
- Each feature cell owns its preferences and stable source bindings.
  `ChartGridContext` registers mounted handles and UI state without copying the Resource.
- `useMarketSeriesSource` reuses `useBars`; one input can populate multiple visual
  series. `useTea` runs each indicator's declarative TeaNode; compilation stays inside it.
  MarketVisuals and TeaVisuals share React-owned ChartSeries and SeriesLegend.
  Style, pane and visibility changes only update presentation.
- AppLayout owns the shared FeedProvider. Leaving Charts closes its subscriptions,
  while the client and Hose remain available to other routes.
- Structure lives in the chart Resource; updates use its revision and shared
  invalidation stream. Shared Query mutation options serialize writes and read
  the latest revision. Appearance lives in ordinary Zustand persist stores.
- Drawing Resources persist geometry/style/visibility for a dashboard and
  provider-scoped listing. Query reads all pages and serializes edits with current
  revisions. Core receives projections plus pending edits; drafts remain local.
  Gesture completion flushes edits, and route/listing changes flush to the original
  owner. Failed writes stay visible with Retry. Removing a chart preserves drawings;
  deleting its Dashboard cascades them.
- Canvas menus use Radix virtual anchors and shared styles. Symbol dialogs
  retain their target and remain open until the Resource save succeeds.
- DataFrames retain every column, label, and gap. Only the renderer boundary
  converts milliseconds to seconds. Corrections merge by timestamp.
- Live updates preserve zoom. A historical viewport stays on its dates; Latest
  resumes the live window. Renderer caches never enter Zustand or storage.

The migration replaces development-only numeric listing IDs with provider-scoped
Listing JSON. Legacy cells that cannot supply that identity are removed; their
chart and dashboard roots remain. The session-coverage migration preserves valid
cells and all their children.

## Availability limits

- Calendar Feed is unavailable: no exchange schedule, market-status, session
  shading, or countdown is fabricated. Display timezone remains selectable.
- Indicators use Tea directly. Formula opens the study library: typing filters
  authored content and Workspace files; Enter/Send creates an ordinary Agent
  Session and navigates to its full-page chat. App composition captures the chart
  target before navigation and hands the unchanged draft to the shared Agent.
  Discovery uses semantic purposes and actual charts over 50 packaged real daily
  histories spanning stocks, ETFs and crypto in 2022 and 2024, each packaged with
  the same market's captured weekly and monthly bars. A stable shuffled
  assignment gives each study one example across cards, detail, search and reopen.
  Query retains each example; finite Tea `Samples`
  reuse the same cached rows without Feed subscriptions, pagination or live data.
  A preview runs on supplied history (`ObserveRequest.samples`): the service
  reads nothing from Feed and fills a `request.security` line for the same
  market's days, weeks or months from the example, refusing any other. Local Tea RPC
  computes every study in the active tab once; scrolling keeps its execution and
  data mounted while the renderer may pause painting. Changing inputs does not
  acquire market data.
  Provenance stays in the assets; there are no caption labels or example selector.
  Details show a breadcrumb,
  reading guide, recreation prompt and compiled Inputs when the study has them;
  defaults that follow the chart show the values the preview ran with.
  My scripts excludes catalog originals. Selecting a file there or in search
  results closes the library and opens the exact Workspace file directly,
  without compiling or attaching it to the chart. Catalog studies retain their
  previews, and Open source opens their exact Workspace file the same way.
  Duplicate actions copy disk bytes beside their source with create-only writes,
  preserving relative imports.
  Add to chart uses the destination chart's market, not the chosen library example.
  Startup ensures all built-ins exist as read-only originals in the default Workspace.
  The file API rejects editing, deletion and rename; copies remain editable;
  external deletions are repaired on the next startup. My scripts accepts
  any registered Workspace. Adding a study creates an Indicator Resource holding a
  snapshot of the script and its imports plus only explicit parameter overrides.
  Script edits apply on Reload, which re-snapshots; reopening reuses the snapshot.
  The library and a Dashboard Workspace tab's Add to chart share `useAddIndicator`:
  after the install or save, a mounted flow reads the file afresh with
  `useTeaDefinition`, then decides once: it opens the required-inputs dialog
  (kept, with its typed values, while the file changes) or calls
  `addIndicator`; unmount releases its compilation. `AddToChartAction` offers
  Reload on chart instead when that chart already runs the file.
  A missing file fails Reload and keeps the old snapshot; incompatible overrides
  remain visible errors. Startup rewrites read-only built-in originals to the
  bundled text; files under My scripts are never overwritten.
- Chart scripts start with `indicator("My study", overlay = false)`.
  Numeric set outputs and Tea `plot`/`hline`/`verticalProfile` values are
  supported; only the last profile written for each box start is drawn. Plots currently
  use line/histogram styles and zero offset. Scripts with `request.*` lines run
  without chart configuration: the server fills each request child from its line.
  A header with `timeframe = "auto"` makes the server run the script on finer
  bars of the chart's listing; each chart bar then shows the last row that
  opened inside it. The legend names what a script reads beyond the chart's
  bars, the finer bars first, such as “1h · 1M”, and adds a muted
  “from 3 Mar 2024” when the finer rows start after the chart's first bar ends.
  Append events, fills and drawing outputs require additional renderer support.
- Shared Tea metadata owns defaults and outputs; the template catalog only browses
  installation candidates. Empty overrides follow defaults; “Use script default”
  removes a saved choice. Removed/renamed parameters must be reset explicitly.
  A default that follows the chart (`chartDefault`) is never sent unless
  chosen, so each run resolves it; the form shows the run's value from its
  config. An auto script's Timeframe offers the provider's bars up to the
  chart's interval.
- Volume profiles spread each bar's volume over its high-low range, so finer bars
  are more precise. The visible-range and fixed-range profiles run the hidden
  range built-in on the finest resolution the provider offers for the chart's
  session and adjustment, from 1m up to the chart's own, at which the run reads
  at most about 5,000 bars. The visible range's settings, saved on its binding,
  can choose its Lower timeframe instead, used while the provider offers it
  there, it is no coarser than the chart and the range holds at most about
  100,000 of its bars (else the finest coarser ones that fit), and its Number
  of volume bars; the form says which bars are in use and why when they differ
  from the choice, such as the provider's retention. A
  range ending by the open of the chart's newest bar reads only its own bars,
  writes its profile on the last of them and completes; one reaching further
  runs live and counts its bars until now. The chart's bars, not the clock,
  decide, since a delayed market's bars lag it. The visible range's legend
  names the resolution, such as “Visible range · 4h”. When the provider can't
  serve those bars before the run draws, such as Yahoo's intraday bars past
  their retention, that range steps to the next coarser offered bars, down to
  the chart's own.
  The session profile is an ordinary Indicator with `timeframe = "auto"`, so on
  a daily chart it counts hourly bars over the chart's whole window, from where
  the provider keeps them.
  Profile parts carry titles (“Up volume”, “Down volume”, “Point of control”).
  Style lists them in their drawn colors and saves a choice by title in chart
  preferences, which repaints without running anything; a hidden profile stays
  placed, invisible, so Style still lists its parts.

- Comparison inputs must support the chart's shared interval/session/adjustment.
- Resource presets are regular grids; V1 T-shaped and mixed-row templates remain
  outside the current Resource contract.
- Agent overlays await a real OpenChart producer contract.

Automated tests exercise the Feed, renderer and grid together. Production app code
imports no mock Feed.

See [the architecture](../../../../docs/architecture/chart.md) for the three
diagrams, interfaces, state ownership, migration decisions and verification scope.
