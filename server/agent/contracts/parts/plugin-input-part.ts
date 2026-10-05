// Purpose: Owns plugin input Parts and their accepted input variants.

import { Schema, SchemaGetter, Struct } from "effect";
import { BarsSeries } from "@openchart/feed/bars";
import { PartBase } from "./part-base";

/** Canonical alert trigger plugin input schema for agent transcript content. */
export const AlertTriggerPluginInputSchema = Schema.Struct({
  type: Schema.Literal("alert_trigger"),
  eventId: Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.passthrough(),
    }),
  ).check(Schema.isMinLength(1)),
})
  .mapFields(Struct.map(Schema.mutableKey))
  .annotate({ parseOptions: { onExcessProperty: "error" } })
  .annotate({ identifier: "AlertTriggerPluginInput" });
/** Parsed alert trigger plugin input value value. */
export type AlertTriggerPluginInputValue =
  typeof AlertTriggerPluginInputSchema.Type;

/** References a saved Drawing with the gesture's frozen bar settings. */
export const ChartExplainPluginInputSchema = Schema.Struct({
  type: Schema.Literal("chart_explain"),
  drawingId: Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.passthrough(),
    }),
  ).check(Schema.isMinLength(1)),
  resolution: BarsSeries.fields.resolution,
  session: BarsSeries.fields.session,
  adjustment: BarsSeries.fields.adjustment,
})
  .mapFields(Struct.map(Schema.mutableKey))
  .annotate({ parseOptions: { onExcessProperty: "error" } })
  .annotate({ identifier: "ChartExplainPluginInput" });
/** Parsed Chart Explain input referencing a saved Drawing Resource. */
export type ChartExplainPluginInputValue =
  typeof ChartExplainPluginInputSchema.Type;

/** Canonical watchlist semantic row context schema for agent transcript content. */
export const WatchlistSemanticRowContext = Schema.Struct({
  nodeId: Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.passthrough(),
    }),
  ).check(Schema.isMinLength(1)),
  listingId: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
  symbol: Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.passthrough(),
    }),
  ).check(Schema.isMinLength(1)),
  name: Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.passthrough(),
    }),
  ).check(Schema.isMinLength(1)),
  groupPath: Schema.Array(
    Schema.String.pipe(
      Schema.decode({
        decode: SchemaGetter.transform((value) => value.trim()),
        encode: SchemaGetter.passthrough(),
      }),
    ).check(Schema.isMinLength(1)),
  )
    .pipe(Schema.mutable)
    .check(Schema.isMaxLength(64)),
})
  .mapFields(Struct.map(Schema.mutableKey))
  .annotate({ parseOptions: { onExcessProperty: "error" } });
/** Parsed watchlist semantic row context value. */
export type WatchlistSemanticRowContext =
  typeof WatchlistSemanticRowContext.Type;

/** Canonical watchlist semantic cell plugin input schema for agent transcript content. */
export const WatchlistSemanticCellPluginInput = Schema.Struct({
  type: Schema.Literal("watchlist_semantic_cell"),
  watchlistId: Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.passthrough(),
    }),
  ).check(Schema.isMinLength(1)),
  columnId: Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.passthrough(),
    }),
  ).check(Schema.isMinLength(1)),
  nodeId: Schema.String.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.passthrough(),
    }),
  ).check(Schema.isMinLength(1)),
  row: WatchlistSemanticRowContext,
})
  .mapFields(Struct.map(Schema.mutableKey))
  .annotate({ parseOptions: { onExcessProperty: "error" } })
  .annotate({ identifier: "WatchlistSemanticCellPluginInput" });
/** Parsed watchlist semantic cell plugin input value. */
export type WatchlistSemanticCellPluginInput =
  typeof WatchlistSemanticCellPluginInput.Type;

/** Canonical plugin input schema for agent transcript content. */
export const PluginInput = Schema.Union([
  AlertTriggerPluginInputSchema,
  ChartExplainPluginInputSchema,
  WatchlistSemanticCellPluginInput,
]).annotate({ identifier: "PluginInput" });
/** Parsed plugin input value. */
export type PluginInput = typeof PluginInput.Type;

/** Canonical plugin input part schema for agent transcript content. */
export const PluginInputPart = Schema.Struct({
  ...PartBase.fields,
  type: Schema.Literal("plugin_input"),
  input: PluginInput,
})
  .mapFields(Struct.map(Schema.mutableKey))
  .annotate({ parseOptions: { onExcessProperty: "ignore" } })
  .annotate({
    identifier: "PluginInputPart",
  });
/** Parsed plugin input part value. */
export type PluginInputPart = typeof PluginInputPart.Type;
