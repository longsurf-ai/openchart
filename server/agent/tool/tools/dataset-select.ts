// Purpose: Expose finite reads of Workspace Datasets through Feed, including why a file cannot be read.
import * as Tool from "@openchart/server/agent/tool/tool";
import { Feed } from "@openchart/server/feed/service";
import { SeriesRequest } from "@openchart/feed";
import { Effect, Result, type Schema } from "effect";
import { DatasetWindowTooLarge } from "./errors";

const maximumRows = 1_000;

/** One read of a Workspace Dataset, optionally limited to a time range. */
export const Parameters = SeriesRequest;

// The deepest server-side cause, such as the CSV row a declaration rejected.
function detail(error: unknown): string | undefined {
  let current = error;
  let message: string | undefined;
  while (current instanceof Error) {
    if (current.message) message = current.message;
    current = current.cause;
  }
  return message;
}

// JSON has no NaN; keep the observation with a null cell.
const jsonValue = (value: unknown) =>
  typeof value === "number" && !Number.isFinite(value) ? null : value;

/**
 * Reads a Workspace Dataset's declared columns as the chart and Feed see them.
 * A Dataset that is not ready yet, a missing file, or a file that does not
 * match its declaration returns status: 'rejected' with the reason and the
 * row or column at fault, so the file can be fixed. Larger windows fail intact.
 * @example yield* tool.execute({id: "wsd_x", from: 1_704_067_200_000}, context);
 */
export const DatasetSelectTool = Tool.define(
  "dataset_select",
  Effect.succeed({
    description: `Read a workspace_dataset's rows through the same path charts use. Supply its id and optionally from (inclusive) and to (exclusive) in epoch milliseconds. Use it after creating or changing a Dataset or its CSV file to confirm OpenChart can read it. Results contain ascending rows with time in epoch milliseconds and each declared column; missing cells are null. status: 'rejected' means OpenChart cannot read the Dataset yet: reason names why and detail names the file row or column to fix. A Dataset created moments ago may briefly report SourceUnavailable. More than ${maximumRows} rows fails; narrow the range.`,
    parameters: Parameters,
    execute: Effect.fn("DatasetSelect.execute")(function* (
      request: typeof Parameters.Type,
      context: Tool.Context,
    ): Effect.fn.Return<Tool.ExecuteResult, unknown, Feed> {
      yield* context.ask({
        permission: "dataset_select",
        patterns: [request.id],
        always: ["*"],
        metadata: request,
      });
      const { series } = yield* (yield* Feed).get();
      const result = yield* Effect.result(series.select(request));
      if (Result.isFailure(result))
        return {
          title: `Dataset unavailable: ${request.id}`,
          metadata: {},
          output: {
            type: "json" as const,
            value: {
              status: "rejected" as const,
              reason: result.failure.reason._tag,
              detail: detail(result.failure.cause) ?? null,
            },
          },
        };
      const frame = result.success;
      if (frame.numRows > maximumRows)
        return yield* Effect.fail(
          new DatasetWindowTooLarge({
            rows: frame.numRows,
            maximum: maximumRows,
          }),
        );
      return {
        title: `Dataset: ${request.id}`,
        metadata: {},
        output: {
          type: "json" as const,
          value: {
            status: "ok" as const,
            // Scalar declared columns only: numbers, strings, booleans and null.
            rows: Array.from(
              frame,
              (row) =>
                Object.fromEntries(
                  Object.entries(row).map(([key, value]) => [
                    key,
                    jsonValue(value),
                  ]),
                ) as Schema.JsonObject,
            ),
          },
        },
      };
    }),
  }),
);
