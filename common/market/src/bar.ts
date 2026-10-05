// Purpose: Name the columns every Bars source supplies, so consumers never rely on provider-specific names.
import { Schema } from "effect";

/**
 * The columns every Bars source supplies beside `time`. Sources may keep native
 * columns next to them. A cell may be missing (for example, no volume for an
 * index), but the column itself is required.
 */
export const BarColumns = {
  open: Schema.Finite,
  high: Schema.Finite,
  low: Schema.Finite,
  close: Schema.Finite,
  volume: Schema.Finite,
} as const;
export type BarColumns = typeof BarColumns;

/** One canonical bar column name. */
export type BarColumn = keyof BarColumns;
