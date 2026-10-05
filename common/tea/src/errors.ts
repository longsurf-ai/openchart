// Purpose: Safe Tea failures shared by service and consumer transports.
import { Schema } from "effect";

/** Public failures; underlying provider/compiler causes remain server-owned. */
export const Failure = Schema.Struct({
  code: Schema.Literals([
    "compile_failed",
    "invalid_request",
    "node_unavailable",
    "invalid_data",
    "upstream",
    "cancelled",
    "internal",
  ]),
  message: Schema.NonEmptyString,
});
export type Failure = typeof Failure.Type;

/** Safe ordinary error used as the Tea service Effect error channel. */
export class Error extends globalThis.Error {
  readonly _tag = "TeaError";
  readonly code: Failure["code"];
  /** Retain an optional server-only cause without exposing it on the wire.
   * @example new Error({code: "node_unavailable", message: "Tea node is unavailable"});
   */
  constructor(failure: Failure, options?: ErrorOptions) {
    super(failure.message, options);
    this.name = "TeaError";
    this.code = failure.code;
  }
}
