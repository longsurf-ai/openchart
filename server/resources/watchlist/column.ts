// Purpose: Owns the inline column contract shared by watchlist persistence and entity validation.

import { defineId } from "@openchart/identifier";
import { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { Adjustment, Resolution } from "@openchart/feed";
import { SessionType } from "@openchart/market";
import { ReadInput } from "@openchart/server/workspace/contract";
import * as Tea from "@openchart/tea";
import { Effect, Schema } from "effect";

/** Optional authored title; omitting it lets presentation derive the output title. */
export const WatchlistColumnTitle = Schema.NonEmptyString.check(
  Schema.isMaxLength(200),
);

/** Per-column cadence; omitted session/adjustment use the row provider's defaults. */
export const WatchlistFormulaBars = Schema.Struct({
  resolution: Resolution,
  session: Schema.optionalKey(SessionType),
  adjustment: Schema.optionalKey(Adjustment),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

/** A complete, independently saved Tea program and its selected numeric output. */
export const WatchlistFormulaMetric = Schema.Struct({
  kind: Schema.Literal("formula"),
  source: Schema.Struct({
    workspaceId: ReadInput.fields.workspaceId,
    path: ReadInput.fields.path.check(
      Schema.makeFilter((path) => path.endsWith(".tea")),
    ),
  }),
  snapshot: Tea.SnapshotSources.fields.sources,
  parameterOverrides: Tea.NodeParameters,
  output: Schema.NonEmptyString,
  bars: WatchlistFormulaBars,
})
  .check(
    Schema.makeFilter(
      ({ source, snapshot }) => Object.hasOwn(snapshot, source.path),
      { message: "The snapshot must contain the code at source.path" },
    ),
  )
  .annotate({ parseOptions: { onExcessProperty: "error" } });

/** Persisted Formula calculation configuration, without results or subscriptions. */
export type WatchlistFormulaMetric = typeof WatchlistFormulaMetric.Type;
/** Persisted Formula market settings, resolved separately for each row. */
export type WatchlistFormulaBars = typeof WatchlistFormulaBars.Type;

/**
 * A metric selected by a watchlist column, discriminated by `kind`.
 * Each variant owns its parameters; add new metrics as union members.
 * Market values come from Feed; research answers are bound Sessions' final replies.
 * Semantic columns store the shared Agent prompt, never execution state.
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
  // The latest session day's intraday prices against the previous close.
  Schema.Struct({ kind: Schema.Literal("priceHistory") }),
  WatchlistFormulaMetric,
  Schema.Struct({
    kind: Schema.Literal("semantic"),
    prompt: AgentPromptInput,
  }),
]).annotate({ parseOptions: { onExcessProperty: "error" } });

/** A metric selected by a watchlist column. */
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
  title: Schema.optionalKey(WatchlistColumnTitle),
  visible: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  metric: WatchlistMetric,
}).annotate({ parseOptions: { onExcessProperty: "error" } });

/** One column configuration without an independent lifecycle or revision. */
export type WatchlistColumn = typeof WatchlistColumn.Type;
