// Purpose: Cartesian 2D coordinate system implementation (data-to-pixel transforms)
// Module:  @openchart/chart-core / coord

import { CoordSys } from "./def";

export function createCartesian2D(
  bounds: CoordSys.Bounds,
  extents: CoordSys.Extents,
  defaultYScale = "right",
  scaleConfigs?: Record<string, CoordSys.ScaleConfig>,
): CoordSys.State {
  const xScale: CoordSys.Scale = {
    extent: [extents.x.min, extents.x.max],
    range: [bounds.x, bounds.x + bounds.width],
    mode: "linear",
  };

  const yScales: Record<string, CoordSys.Scale> = {};
  for (const id of Object.keys(extents.y)) {
    const e = extents.y[id]!;
    const cfg = scaleConfigs?.[id];
    const from = cfg?.from ?? 0;
    const to = cfg?.to ?? 1;
    const mode = cfg?.mode ?? "linear";
    const bottom = bounds.y + bounds.height;
    const top = bounds.y;
    const rangeBottom = bottom - (bottom - top) * from;
    const rangeTop = bottom - (bottom - top) * to;
    // In log mode, clamp extent min to a positive value since log(0) is undefined.
    // Use 1 as the floor — values below 1 are meaningless on a log scale.
    let extMin = e.min;
    if (mode === "log" && extMin <= 0) {
      extMin = Math.min(1, e.max * 0.01);
    }
    yScales[id] = {
      extent: [extMin, e.max],
      range: [rangeBottom, rangeTop],
      mode,
    };
  }

  if (Object.keys(yScales).length === 0) {
    yScales.right = {
      extent: [0, 100],
      range: [bounds.y + bounds.height, bounds.y],
      mode: "linear",
    };
  }

  return {
    type: "cartesian2d",
    bounds,
    scales: { x: xScale, y: yScales },
    defaultYScale,
  };
}
