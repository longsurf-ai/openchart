// Purpose: Map request mistakes, thrown causes and Feed failures into the Tea error channel.
import { Effect } from "effect";
import type { FeedError } from "@openchart/feed";
import * as Tea from "@openchart/tea";

/**
 * A catch handler that keeps a Tea.Error as it is and turns any other cause
 * into `code` with the cause's message, or `fallback` when it has none or
 * it is empty (a Tea.Failure message is never empty).
 * @example Effect.try({ try: run, catch: teaError("invalid_data", "Tea execution failed") });
 */
export const teaError =
  (code: Tea.Failure["code"], fallback: string) =>
  (cause: unknown): Tea.Error =>
    cause instanceof Tea.Error
      ? cause
      : new Tea.Error(
          {
            code,
            message: (cause instanceof Error && cause.message) || fallback,
          },
          { cause },
        );

/** {@link teaError} for a request the service cannot look up or build. */
export const invalidRequest = teaError(
  "invalid_request",
  "Invalid Tea configuration",
);

/**
 * Fail with invalid_request. The message says what is wrong and where, such
 * as `At least one input is required at nodes.rsi`.
 * @example if (empty) return yield* invalid(`At least one input is required at ${where}`);
 */
export const invalid = (message: string) =>
  Effect.fail(new Tea.Error({ code: "invalid_request", message }));

/**
 * Run one synchronous Tea step, such as `Module.bind`. A Tea.Error stays as
 * it is; any other throw becomes invalid_request with its message and
 * ` at <where>`.
 * @example tree = yield* at("root", () => tree.bind(parameters));
 */
export const at = <A>(where: string, step: () => A) =>
  Effect.try({
    try: step,
    catch: (cause) =>
      cause instanceof Tea.Error
        ? cause
        : new Tea.Error(
            {
              code: "invalid_request",
              message: `${(cause instanceof Error && cause.message) || "Invalid Tea configuration"} at ${where}`,
            },
            { cause },
          ),
  });

/** Map safe provider failures into the Tea observation channel.
 * @example source.pipe(Effect.mapError(upstream));
 */
export function upstream(cause: FeedError): Tea.Error {
  return new Tea.Error({ code: "upstream", message: cause.message }, { cause });
}
