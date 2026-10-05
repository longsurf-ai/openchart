// Purpose: Return finite Tea execution results to the Agent through the existing TeaService.
import { Effect, Predicate, Schema } from "effect";

import { TimeRange } from "@openchart/timeseries";
import * as Tool from "@openchart/server/agent/tool/tool";
import * as Tea from "@openchart/server/tea/tea";
import { fatal } from "@openchart/utils/assert";
import { TeaRunOutputTooLarge } from "./errors";
import {
  TeaSourceFields,
  hasTeaSource,
  resolveTeaSource,
  compilationSource,
  describeTea,
  teaConfigDescription,
} from "./tea-shared";

const maximumRows = 1_000;
const maximumCharacters = 200_000;

/** Fixed bounds prevent an Agent call from opening a live observation. */
export const Parameters = TimeRange.mapFields(
  (fields) => ({
    ...fields,
    to: Schema.Int,
    ...TeaSourceFields,
    config: Tea.NodeConfig,
  }),
  { unsafePreserveChecks: true }, // Numeric bounds retain TimeRange's ordering check.
)
  .pipe(
    Schema.refine(hasTeaSource, {
      message: "Supply exactly one of path or source",
    }),
  )
  .annotate({ parseOptions: { onExcessProperty: "error" } });

// Preserve null vs NaN and exact integer values in the model's JSON projection.
function jsonValue(value: unknown): Schema.Json {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value instanceof Map)
    return Array.from(value, ([key, item]) => [
      jsonValue(key),
      jsonValue(item),
    ]);
  if (Predicate.isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  return fatal("Unsupported Tea output value");
}

/**
 * Compiles, binds and evaluates one fixed historical interval, returning the
 * compiled definition and nested JSON rows. The config may name no other
 * nodes, so a NodeRef input fails; Samples inputs run without Feed. It warms
 * {@link Tea.standardWarmupBars} bars, like charts and alerts, so the Agent
 * sees the values they show; TeaService owns execution. Scope releases the
 * compilation and Feed sessions on success, failure or cancellation. Expected
 * Tea failures become diagnostics; permissions, defects and interruption
 * propagate. Oversized results fail intact instead of silently truncating
 * computed output.
 * @example yield* tool.execute({path: "indicators/sma.tea", config, from: 0, to: 60_000}, context);
 */
export const TeaRunTool = Tool.define(
  "tea_run",
  Effect.succeed({
    description: `Run Tea over a finite historical window and inspect actual output values. Supply exactly one of path (absolute, or relative to this invocation's workspace cwd) and source (self-contained text without relative imports), config, and from/to as epoch milliseconds, from inclusive and to exclusive. ${teaConfigDescription} Use tea_check without config to see the script's parameters, columns and requests if needed. Compilation and binding happen automatically, so a prior check is unnecessary. A Bars input loads market data and warmup from Feed. A script whose indicator() header sets timeframe = "auto" runs on finer bars of the same listing over the same window, such as 1h for 1d Bars, starting where the provider's history of those bars does, and returns a row per finer bar. To supply the bars yourself without Feed, use a Samples input: the same fields as a Bars input, with _tag "Samples" and rows: [{time, open, high, low, close, volume}]. time is epoch milliseconds; the prices and volume are finite numbers, or null for missing values. Times must strictly ascend; every row is a completed bar, with no intrabar updates. Include earlier rows for warmup. Samples keep the series fields, so syminfo and timeframe still work. To run a request child over Samples too, give it a config in requests; a left-out child loads its listing's bars from Feed. Only rows inside the requested window are returned. Derive expected outputs from the requirement and compare them with returned rows; status: ok means execution succeeded, not that behavior matched expectations. Results include range, then ascending rows with nested structs and event lists intact, alertOutputs, declaration (the indicator() header, or null) and definition (as tea_check returns it); maps in rows are arrays of [key, value] pairs. NaN/Infinity/-Infinity are the strings "NaN"/"Infinity"/"-Infinity"; 64-bit integers are decimal strings, and null stays null. Empty rows is valid. A latest candle may still be provisional. More than ${maximumRows} rows or ${maximumCharacters} serialized result characters fails; shorten the window or emit fewer fields. Expected Tea failures return status: 'rejected' with code and message. The call releases all temporary resources; it creates no alerts, notifications or chart attachments.`,
    parameters: Parameters,
    execute: Effect.fn("TeaRun.execute")(function* (
      input: typeof Parameters.Type,
      context: Tool.Context,
    ) {
      const request = yield* resolveTeaSource(input, context);
      yield* context.ask({
        permission: "tea_run",
        patterns: [request.path ?? "inline"],
        always: ["*"],
        metadata: {},
      });
      const tea = yield* Tea.Service;
      const value = yield* Effect.scoped(
        Effect.gen(function* () {
          const node = yield* Effect.acquireRelease(
            tea.compile(yield* compilationSource(request)),
            (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
          );
          const { snapshot } = yield* tea.observe({
            id: node.id,
            ...input.config,
            nodes: {},
            from: input.from,
            to: input.to,
            countBack: 1,
            warmupBars: Tea.standardWarmupBars,
          });
          const rows: Schema.JsonObject[] = [];
          for (const row of snapshot.data) {
            // Feed's minimum countBack can extend an empty interval backwards.
            if (row.time < input.from || row.time >= input.to) continue;
            if (rows.length === maximumRows)
              return yield* new TeaRunOutputTooLarge({
                maximumRows,
                maximumCharacters,
              });
            rows.push(
              Object.fromEntries(
                Object.entries(row).map(([key, item]) => [
                  key,
                  jsonValue(item),
                ]),
              ),
            );
          }
          // The config is not echoed: Samples rows would count twice toward the
          // limit. Rows come first: a replay of a long result keeps only its start.
          const { definition, alertOutputs } = describeTea(node.definition);
          const result = {
            status: "ok",
            range: { from: input.from, to: input.to },
            rows,
            alertOutputs,
            declaration: node.declaration,
            definition,
          };
          if (JSON.stringify(result).length > maximumCharacters)
            return yield* new TeaRunOutputTooLarge({
              maximumRows,
              maximumCharacters,
            });
          return result;
        }),
      ).pipe(
        Effect.catchTag("TeaError", (error) =>
          Effect.succeed({
            status: "rejected",
            code: error.code,
            message: error.message,
          }),
        ),
      );
      return {
        title: "Run Tea",
        metadata: {},
        output: { type: "json" as const, value },
      };
    }),
  }),
);
