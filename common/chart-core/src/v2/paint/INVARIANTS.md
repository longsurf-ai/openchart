# paint

Stateless repaint pipeline that reads `Chart.State`, computes layout, coordinate systems, and visible extents, then renders every visual layer (grid, series, axes, crosshairs, drawings, floating overlays) onto a single `<canvas>`.

## Invariants

- `repaint` is **stateless by design**: it never mutates `Chart.State`; all mutable bookkeeping lives in `RuntimeState` (caches, canvas refs, pending frames).
- Drawing label placements use the same projected anchors and clipping as their painted boundaries. Reset their runtime map before the empty-series return. DOM consumers read detached coordinates/angles after paint; placements never become persisted drawing geometry.
- Focused-series emphasis uses semantic glow tokens; do not add local fallback palettes here.
- Crosshair Y labels use an axis owned by `crosshair.paneId`: prefer focus within that pane, then its primary series (declared main before registration order). Reuse the painted scale; absent pane/axis means no Y label, never another pane's scale.
- X-runtime computation is cached via a string signature; any new x-axis config field must be included in `computeXRuntimeSignature` or stale positions will be drawn.
- Annotation layout/raster placement is cached in `RuntimeState` with separate solve and position signatures. Crosshair-only repaints reuse the cached placements; pure pan/translation may reuse anchor-to-pill-centroid vectors and refresh leaders without rebuilding occupancy, clamping only labels that would leave the viewport. Hover expansion is a frame-local projection from cached compact placements; it must not invalidate the solve signature or re-run neighboring labels. Zoom/resolution/ticker or any annotation/shape change must invalidate the solve signature and re-run placement.
- Painted annotation hit placements are valid only for the annotation interaction state that produced them (`hoveredAnnotationId`, `expandedAnnotation` (id and body disclosure), `activeAnnotationId`). Store that signature with the sorted hit placements; event handling must recompute frame-local expanded placements when the signature does not match current interaction state.
- Event rendering uses separate chart-wide and marker-lane contexts. Highlight bands and chart annotations keep chart-wide coverage, while Marker pins use the pane-local lane owned by the main listing series.
- Annotation data and coordinates belong to the main listing series, independent
  of display-series order. Replacing a chart type may append the price series
  after volume; this must never select the volume scale for price anchors.
- Event and annotation rows retain raw series values. Their render context must
  fold the owning series' percentage/indexed transform into its coordinate
  scale before projecting OHLC or persisted price anchors.
- Annotation layout and hit state may be computed before late overlays, but visible annotation card/pill paint must be deferred until after drawings, drawing overlay labels, value lines, and value tags. Crosshair remains above annotations.
- Mode transforms (percentage/indexed) derive a per-series baseline from the axis anchor when present, otherwise the first visible finite close/value; if the baseline is missing, the series is silently skipped.
- Mode transforms and visible extents are cached per repaint in `RuntimeState.modeCache` keyed by `computeModeExtentSignature` — a value signature of every input they read (comparison topology, per-axis mode/anchor/autoscale/visibleExtent, and per-series type/axis/data-length/endpoints/fieldMap/range). Both are O(series × visible points) and would otherwise recompute every frame; a crosshair hover keeps the signature stable (cache hit), while an anchor drag mutates `axis.modeAnchor.time` (in the signature) and correctly recomputes. Any new input to `buildModeTransforms`/`computeExtents` MUST be added to the signature or the cache serves stale geometry.
- Per-series render geometry is cached across light repaints only when `seriesRenderSignature` still matches. That signature must include the full y-scale pixel range, not only its height, so pane reflows cannot reuse geometry transformed for a different vertical origin.
- `ComparisonState.fixedZeroAxis` changes comparison autoscale extents, not
  series transforms. When enabled for percentage comparison mode, include the
  zero/anchor value and expand the shorter side so the 0% line stays centered.
  Keep this field in `computeModeExtentSignature`.
- `rawVisibleExtent` caches the anchor-independent raw high/low visible extent per (data array, range); `modeExtent` applies the (monotonic) mode transform to `{minLo, maxHi}` so the per-anchor-frame extent is O(1) per series. Monotonicity holds only for percentage/indexed transforms with a positive baseline on a linear scale.
- `foldModeTransformIntoScale` folds an affine mode transform into a linear y-scale's extent so `def.transform` projects raw data without a per-point `transform.point` allocation. It returns null (falling back to the exact per-point path) for non-linear scales, non-affine transforms (an equally-spaced-sample check), or degenerate slopes. The folded coord is local to the `def.transform` call — never leak it to crosshair/value-tag/primitive code, which use the original coord.
- Per-point field resolution (`getFieldMap`) is memoized per series object + `fieldMap` reference; hot loops (`anchoredBaseline`, `seriesValueAtOrBefore`, `modeExtent`, `rawVisibleExtent`) resolve field names once and binary-search the time-sorted data for anchor lookups. Series data is assumed ascending by time (the same ordinal-time invariant the x-axis relies on).
- Floating axes only appear when the bound y-axis has `fixed: false` or `visible: false` and the focused series is set; they are suppressed when they would overlap a fixed right axis.
- Historical extended-session background bands are index-span overlays on contiguous visible pre/post bars. Do not project historical calendar intervals onto ordinal canvas space; only the active current pre/post session may use calendar open/close times to extend a live band beyond received bars.
- X-axis marks and crosshair labels must resolve one timezone through
  `Chart.resolveTimeDisplayTimezone`: daily-or-higher calendar periods use the
  active series' grid-owned calendar timezone, while intraday instants use the
  chart display timezone.
