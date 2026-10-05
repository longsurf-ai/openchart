# Chart integration

App adapters connect external data and product presentation to chart-core.
Core owns generic series, coordinates, primitive lifecycle, painting and hits.

- `indicator-data.ts` and `tea-visual-value.ts` decode nominal Tea values at
  the chart boundary. Never move Tea fields or indicator-specific style rules
  into chart-core. `common/tea` owns nominal output classification.
- `tea-visual-primitive.ts` supplies an ordinary `SeriesPrimitive` through the
  existing core API. Preview and installed studies share it via `TeaVisuals`.
  Descriptors replace transient contributions; they never become user drawings.
- Tea geometry timestamps are exact milliseconds; core rows use seconds.
  Plot offsets move geometry on the logical axis, never market timestamps.
  Segments deduplicate endpoints; zones retain the latest geometry per start.
  Geometry hover dates describe anchors, not inferred confirmation.
- Inline labels avoid visible series and other labels, without background plates.
  A zone output's text is instead one right-edge tag on its latest visible zone.
  When text cannot fit, preserve the marker and hover description.
- Indicator defaults use `indicator-output-style.ts`'s distinct role palette;
  explicit user overrides and authored Tea styles take precedence.
