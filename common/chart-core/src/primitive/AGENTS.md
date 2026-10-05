# primitive

Extensible overlay system for drawing decorations on chart panes and series (price lines, markers, last-value tags) with z-ordered rendering and hit-testing.

## Invariants

- Every primitive must have a globally unique `id` (the built-in factories use `crypto.randomUUID`).
- `PrimitiveWrapper.views()` sorts by z-order; adding a primitive with the wrong `zOrder` will paint it in an unexpected layer.
- `Marker.findIndex` uses `JSON.stringify` equality on `time`, so the time format in marker items must exactly match the format in the data array.
- `replaceOwned` replaces only one source's primitives on a series; removing a
  source must preserve sibling indicators. Removal/disposal calls `detached`.
- Every layer uses geometry updated before background paint. Hit tests consume
  the last painted pane bounds; source changes replace all owned contributions.
- Label obstruction uses already-transformed visible series ink, clipped before
  rasterization. Grid and soft fills do not obstruct labels. Cursor paints reuse
  the last geometry paint's query; data/layout paints replace it.
