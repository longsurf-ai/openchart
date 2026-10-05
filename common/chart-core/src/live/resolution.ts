// Purpose: Timezone-aware bar-boundary math for mapping tick timestamps to resolution periods
// Module:  @openchart/chart-core / live
/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
//
// Delegates to @openchart/chart-core/market/resolution-utils — the canonical implementation.
// This namespace wrapper preserves the existing Resolution.* API for @openchart/chart-core consumers.

import * as Tz from "@openchart/chart-core/tz/types";
import type { BarCadence } from "@openchart/chart-core/market/resolution";
import {
  toSeconds as _toSeconds,
  getBarStart as _getBarStart,
  isNewPeriod as _isNewPeriod,
  getBarEnd as _getBarEnd,
} from "@openchart/chart-core/market/resolution-utils";

/**
 * Resolution utilities for bar timestamp calculations.
 * Used to detect period boundaries and aggregate live data into display resolutions.
 */
export namespace Resolution {
  /** Parse resolution string to seconds (e.g., "1h" → 3600, "1d" → 86400) */
  export function toSeconds(resolution: BarCadence): number {
    return _toSeconds(resolution);
  }

  /**
   * Get the start timestamp of the bar containing `time` for given resolution.
   * All timestamps are in seconds (Unix epoch).
   * For daily+ resolutions, uses specified timezone for bar boundaries.
   */
  export function getBarStart(
    time: number,
    resolution: BarCadence,
    tz: Tz.Name = Tz.UTC,
  ): number {
    return _getBarStart(time, resolution, tz);
  }

  /**
   * Check if a new period has started between two timestamps.
   * Returns true if `newTime` is in a different bar than `prevTime`.
   */
  export function isNewPeriod(
    prevTime: number,
    newTime: number,
    resolution: BarCadence,
    tz: Tz.Name = Tz.UTC,
  ): boolean {
    return _isNewPeriod(prevTime, newTime, resolution, tz);
  }

  /**
   * Get the end timestamp of the bar starting at `barStart`.
   * The end is exclusive (start of next bar).
   */
  export function getBarEnd(barStart: number, resolution: BarCadence): number {
    return _getBarEnd(barStart, resolution);
  }
}
