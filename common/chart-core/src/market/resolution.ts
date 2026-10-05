// Purpose: Retain core-second cadence math while deriving supported bars from V2 Feed.
import { Resolution as FeedResolution } from "@openchart/feed";
import { z } from "zod";

export const BarCadence = z.enum(FeedResolution.literals);
export type BarCadence = z.infer<typeof BarCadence>;
export const Resolution = BarCadence;
export type Resolution = BarCadence;
export const Cadence = z.union([z.literal("tick"), BarCadence]);
export type Cadence = z.infer<typeof Cadence>;

export const BAR_CADENCE_SECONDS: Record<BarCadence, number> = {
  "1s": 1,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1W": 604800,
  "1M": 2592000,
};

export function barCadenceToSeconds(cadence: BarCadence): number {
  return BAR_CADENCE_SECONDS[cadence];
}
