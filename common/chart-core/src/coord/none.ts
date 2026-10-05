// Purpose: No-op coordinate system (identity/zeroed transform, used as default fallback)
// Module:  @openchart/chart-core / coord

import { CoordSys } from "./def";

export function createNone(bounds: CoordSys.Bounds): CoordSys.State {
  return {
    type: "none",
    bounds,
    scales: { x: { extent: [0, 0], range: [0, 0], mode: "linear" }, y: {} },
    defaultYScale: "",
  };
}
