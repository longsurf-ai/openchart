# paint

Stateless repaint pipeline that reads `Chart.State`, computes layout, coordinate systems, and visible extents, then renders every visual layer (grid, series, axes, crosshairs, drawings, floating overlays) onto a single `<canvas>`.

Read [INVARIANTS.md](INVARIANTS.md) before changing this module. It preserves the
renderer, state, identity, and lifecycle rules that apply here.
