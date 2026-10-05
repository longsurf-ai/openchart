// Purpose: Name Feed's resolutions with Pine's timeframe strings, as scripts read and request them.
import type { Resolution } from "@openchart/feed";

// Pine's timeframe string for each resolution.
const timeframes: Readonly<Record<Resolution, string>> = {
  "1s": "1S",
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1W": "W",
  "1M": "M",
};

// Each Pine timeframe that names a resolution, including the "1D" spellings.
const resolutions: ReadonlyMap<string, Resolution> = new Map([
  ...Object.entries(timeframes).map(
    ([resolution, timeframe]) => [timeframe, resolution as Resolution] as const,
  ),
  ["1D", "1d"],
  ["1W", "1W"],
  ["1M", "1M"],
]);

/**
 * The resolution a Pine timeframe such as `"60"` or `"D"` names, the way a
 * `request.security` line or a `timeframe` parameter writes it. Undefined for
 * `""` (the script's own timeframe, or the host's pick) and for timeframes
 * Feed has no bars for, such as `"3"`.
 * @example resolutionOf("240"); // "4h"
 */
export const resolutionOf = (timeframe: string) => resolutions.get(timeframe);

/**
 * The Pine timeframe string that names `resolution`, as a script reads it.
 * @example timeframeOf("4h"); // "240"
 */
export const timeframeOf = (resolution: Resolution) => timeframes[resolution];
