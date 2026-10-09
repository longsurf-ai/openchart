// Purpose: Owns the inline column contract shared by watchlist persistence and entity validation.

import { defineId } from "@openchart/identifier";
import { Schema } from "effect";

/**
 * A scalar metric selected by a watchlist column, discriminated by `kind`.
 * Each variant owns its parameters; add new metrics as union members.
 * Values come from Feed and are never part of this configuration.
 * Unknown kinds and properties fail decoding. This schema performs no I/O.
 *
 * @example
 * ```ts
 * Schema.decodeUnknownSync(WatchlistMetric)({ kind: "price" });
 * ```
 */
export const WatchlistMetric = Schema.Union([
  // The current price of this Provider's listing.
  Schema.Struct({ kind: Schema.Literal("price") }),
  // The price change since the previous close, in the listing's currency.
  Schema.Struct({ kind: Schema.Literal("change") }),
  // The price change since the previous close, as a percentage.
  Schema.Struct({ kind: Schema.Literal("changePercent") }),
  // The number of shares or contracts traded during the current session.
  Schema.Struct({ kind: Schema.Literal("volume") }),
]).annotate({ parseOptions: { onExcessProperty: "error" } });

/** A scalar metric selected by a watchlist column. */
export type WatchlistMetric = typeof WatchlistMetric.Type;

/** Identifier of an inline column, with the `wcl_` prefix. */
export const WatchlistColumnId = defineId("wcl", "WatchlistColumn.ID");

/**
 * One ordered column stored inside the watchlist's JSON array and shared by
 * every section. Identity survives reordering; array order defines position.
 * Values, formatting, widths, and sorting are not part of this configuration.
 * Unknown properties and unsupported metrics fail schema decoding.
 * This schema performs no I/O and owns no resources requiring cleanup.
 *
 * @example
 * ```ts
 * Schema.decodeUnknownSync(WatchlistColumn)({
 *   id: "wcl_price",
 *   metric: { kind: "price" },
 * });
 * ```
 */
export const WatchlistColumn = Schema.Struct({
  id: WatchlistColumnId,
  metric: WatchlistMetric,
}).annotate({ parseOptions: { onExcessProperty: "error" } });

/** One column configuration without an independent lifecycle or revision. */
export type WatchlistColumn = typeof WatchlistColumn.Type;
