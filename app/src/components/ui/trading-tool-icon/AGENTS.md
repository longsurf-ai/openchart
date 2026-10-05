# Trading-tool icons

Hand-drawn 24×24 drawing-tool glyphs from the Figma `Icons` file; node ids and
provenance live in `design/icons/trading-tool-layer-1/manifest.json`.

## Invariants

- Glyphs are copied from Figma, not substituted with rounded library icons.
  Add a tool by adding its Figma node and paths here; keep `data-figma-component-node`.
- Strokes inherit `currentColor` and the root stroke width; consumers size the
  SVG with utilities. Anchor dots fill with `--tool-icon-bg`, which the hosting
  surface sets to its own background.
- Generic chrome keeps using Lucide/Hugeicons; this set is only for chart tools.
