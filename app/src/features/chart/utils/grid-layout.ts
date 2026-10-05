// Purpose: Derive CSS Grid tracks and clamp shared boundaries without storing cell rectangles.

type GridSize = 1 | 2 | 3 | 4;

/** Resource presets are rows by columns, with `1` for a single chart. */
export type GridPreset = "1" | Exclude<`${GridSize}x${GridSize}`, "1x1">;

/** The visible presets supported by the chart Resource. */
export const GRID_PRESETS: readonly GridPreset[] = [
  "1",
  "1x2",
  "1x3",
  "1x4",
  "2x1",
  "2x2",
  "2x3",
  "2x4",
  "3x1",
  "3x2",
  "3x3",
  "3x4",
  "4x1",
  "4x2",
  "4x3",
  "4x4",
];

/** Persisted track proportions; pixel positions are always derived. */
export interface GridRatios {
  readonly columns: readonly number[];
  readonly rows: readonly number[];
}

/** Resolve a Resource preset into its fixed number of visible slots. */
export function getGridPreset(preset: GridPreset) {
  const rows = Number(preset.charAt(0));
  const columns = preset === "1" ? 1 : Number(preset.charAt(2));
  return { rows, columns, capacity: rows * columns };
}

/** Normalize stored proportions and fit minimums to the available container. */
export function fitGridTracks(
  weights: readonly number[] | undefined,
  count: number,
  extent: number,
  minimum: number,
): number[] {
  const valid =
    weights?.length === count &&
    weights.every((weight) => Number.isFinite(weight) && weight > 0);
  const values = valid ? weights : Array.from({ length: count }, () => 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  const ratios = values.map((value) => value / total);
  const floor = extent > 0 ? Math.min(minimum / extent, 1 / count) : 0;
  if (ratios.every((ratio) => ratio >= floor)) return ratios;
  // When the container cannot fit every minimum, equal tracks keep all charts reachable.
  const excess = ratios.map((ratio) => Math.max(0, ratio - floor));
  const available = 1 - floor * count;
  const excessTotal = excess.reduce((sum, value) => sum + value, 0);
  return excess.map((value) => floor + (value / excessTotal) * available);
}

/** Move one shared boundary; all other tracks and the outer rectangle stay fixed. */
export function resizeGridTracks(
  ratios: GridRatios,
  axis: keyof GridRatios,
  index: number,
  delta: number,
  extent: number,
  minimum: number,
): GridRatios {
  if (extent <= 0) return ratios;
  const tracks = ratios[axis];
  const left = tracks[index],
    right = tracks[index + 1];
  if (left === undefined || right === undefined) return ratios;
  const floor = Math.min(minimum / extent, 1 / tracks.length);
  const change = Math.max(
    floor - left,
    Math.min(right - floor, delta / extent),
  );
  if (change === 0) return ratios;
  const next = [...tracks];
  next[index] = left + change;
  next[index + 1] = right - change;
  return { ...ratios, [axis]: next };
}
