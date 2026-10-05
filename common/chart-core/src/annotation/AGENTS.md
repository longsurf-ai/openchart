# annotation

Shared automatic layout, canvas painting and hit geometry for chart annotations.

- Drawing Resources own self-contained annotation content and `time`; `drawing.ts`
  derives render inputs without Event records, fabricated identities or a second collection.
- `ChartStateModel.annotationItems` joins these projections with event-backed
  overlays. `Renderable` contains only layout/paint inputs, not database metadata.
- Canvas and React cards consume the same expanded placement. Prices, pixel bounds,
  hover and expansion are transient; annotation Drawings keep `anchors: []`.
- Effect schemas reuse Drawing geometry/style and OpenChart Market identity where applicable.

Read [INVARIANTS.md](INVARIANTS.md) before changing layout or interaction behavior.
