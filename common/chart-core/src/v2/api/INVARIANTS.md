# api

Public entry point for the v2 chart runtime. Wires a canvas element to the chart state by creating a renderer (owns the paint loop and canvas lifecycle) and binding DOM events that translate user interactions into state mutations.

## Invariants

- `setupEvents` captures `getState`/`setState` closures; the state reference must always be fresh (never stale snapshots) or crosshair and drag will desync.
- `scheduleRender` coalesces via `requestAnimationFrame` and merges invalidation masks, so calling it multiple times per frame is safe but the mask must be correct.
- `ChartRenderer.scheduleResize` is the only public resize entrypoint. It may
  update CSS size immediately so the last completed bitmap stays visible, but
  it must defer the destructive backing-store resize until the same animation
  frame that performs the required `full` repaint. A pending resize must match
  `Chart.State.config.chart.dimensions` when that frame commits.
- Drawing drag uses window-level `mouseup`/`mousemove` listeners that are added on mousedown and removed on release; forgetting cleanup causes ghost drags.
- Drawing creation, handle edits and body translation preserve time/price anchors in the blank margins. Pointer conversion and `anchorToPoint` extrapolate from the same adjacent edge bars; insufficient/degenerate edges stay unresolved. Body translation starts from painted coordinates, never clamps anchors independently. `indexFromTime` remains a bounded nearest-bar lookup for legacy tools. Freehand, polyline, rectangle, triangle, and curved-line anchors instead use continuous piecewise time-to-ordinal interpolation inside loaded bars, shared by paint/hit/handles and inverse pointer conversion; a future fractional anchor never snaps when its next bar arrives. Projection does not invent market data.
- Pane separator drag deltas are pointer pixels, while pane heights are model units. Convert through the drag-start layout area before mutating heights so live canvas resizing and stale persisted height totals do not change drag speed.
- Event and helper read paths must use resolved series data; populated visual `series.data` remains authoritative, while empty series may fall back to `dataRef` data.
- Chart Explain mouseup holds the completed range as `mode: "annotating"`
  before publishing the completed gesture, until the host clears it after the
  persistence/submission handoff. The host saves the Drawing, starts Agent
  execution and projects Session progress into
  `drawings.sessionProgress`; core owns gestures and painting. Invalid or
  cancelled drags clear the preview immediately.
- Chart Explain chooses the scanner color at drag start and must carry that
  same color through the draft band, held annotating band, and
  `ChartEvent.ChartExplainRange` payload. The frontend handoff reuses this
  color for the saved Drawing so a single selection does not visually recolor
  after submission.
- `drawings.activeTool` selects every drawing tool, including `agent_session`.
  Core dispatches range gestures separately from anchor-based creation. A valid
  range clears `activeTool` only when `drawings.toolLocked` is false and reports
  the auto-clear through `onDrawingToolAutoClear`. Escape, tool switches and
  disposal cancel unfinished ranges and release their window listeners.
- Chart Explain mode is captured at drag start from `state.chartExplain.mode`
  and published with the completed range. Do not read mode from rail component
  state inside canvas event handling.
- Annotation hover geometry is canvas-owned. `setupEvents` may keep an
  immediate in-canvas hovered annotation id to bridge renderer-state routing
  between pointer events, but DOM chrome must remain a projection of published
  annotation hover hits.
- A repaint that changes an expanded annotation card must republish its
  canonical hover hit after layout so DOM chrome, hit-testing, and the canvas
  leader consume the same rectangle even while the pointer is over DOM chrome.
- Annotation hit-testing should prefer the renderer's last painted placements.
  Falling back to layout is only for cold-start/stale-cache cases; the pointer
  move path must not solve the full annotation raster placement problem just to
  update crosshair state.
- `hitEventStrip` must early-return `null` before building any drawing context
  when the chart has no annotations, earnings markers, and no in-progress
  annotation draft — there is nothing to hit, and building the x-position table
  plus layout passes on every crosshair move is the dominant per-pointer-move
  cost on a plain chart. Keep the draft predicate aligned with what paint places
  (paint's `chartAnnotationsForRender`); if paint ever paints a hittable surface
  from new state, add it to this guard.
- Reuse painted annotation hit placements only when their interaction signature
  matches the interaction state being tested. A stale hover/expanded signature
  can make DOM-projected annotation cards visibly larger than their canvas hit
  geometry and collapse on pointer movement.
- Mouseleave cleanup must account for DOM chrome rendered outside the canvas
  subtree. If the pointer is still geometrically inside the chart interaction
  root, do not clear annotation hover just because the DOM related target is
  outside that subtree.
