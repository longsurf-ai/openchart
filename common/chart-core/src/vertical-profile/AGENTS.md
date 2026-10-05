# vertical-profile

Rows laid out along a y axis, each stretched sideways inside a box: volume
profiles, and later open interest by strike or order-book depth. Design:
[chart architecture](../../../../docs/architecture/chart.md).

## Invariants

- A profile shares its y axis with series and never drives autoscale; its
  values only set lengths inside the box.
- Colors live on each segment and level. There is no layer list or highlight
  band to keep aligned. A part's optional `title` is for style controls;
  painting ignores it.
- Layout is a pure function of profile, box and y mapping, recomputed every
  paint; no geometry is cached across frames.
