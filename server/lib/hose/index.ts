// Purpose: Run one scoped Effect Stream per Hose channel with cancellation and safe errors.

import { Effect, Stream } from "effect";
import type { ManagedRuntime } from "effect/ManagedRuntime";
import type { ChannelHandler } from "@openchart/hose";
import type { Context } from "@openchart/server/context";
import { failureFor, InvalidRequest } from "@openchart/server/lib/errors";

/**
 * Parse once and keep the channel scope alive until completion or cancellation.
 * Teardown interrupts source I/O; late results cannot write to a closed channel.
 * A public failure (`failureFor(cause).details.error`) ends the channel with
 * `failed` and that encoded value as its body; any other failure ends it with
 * `invalid_request` when its status is BAD_REQUEST, otherwise `internal`.
 * The runtime is injected through each connection's context; the handler can
 * be declared at module scope and reused by independent servers.
 * @example const handle = streamChannel(Input, input => updates(input));
 */
export function streamChannel<I>(
  schema: { readonly parse: (input: unknown) => I },
  open: (
    input: I,
  ) => Stream.Stream<
    unknown,
    unknown,
    ManagedRuntime.Services<Context["runtime"]>
  >,
): ChannelHandler<Context> {
  return (body, channel, ctx) => {
    const controller = new AbortController();
    let closed = false;
    const program = Effect.scoped(
      Effect.gen(function* () {
        const input = yield* Effect.try({
          try: () => schema.parse(body),
          catch: (cause) => new InvalidRequest(cause),
        });
        yield* open(input).pipe(
          Stream.runForEach((value) =>
            Effect.sync(() => {
              if (!closed) channel.data(value);
            }),
          ),
        );
      }),
    );
    void ctx.runtime.runPromise(program, { signal: controller.signal }).then(
      () => {
        if (!closed) {
          closed = true;
          channel.done();
        }
      },
      (cause) => {
        if (closed) return;
        closed = true;
        const failure = failureFor(cause);
        if (failure.details.error !== null) {
          channel.error("failed", failure.details.error);
          return;
        }
        // failureFor already logged an unclassified cause as `internal`; a
        // classified one without a public error is logged here, never sent.
        if (failure.code !== "internal")
          console.warn("Hose channel failed", failure.code, cause);
        channel.error(
          failure.status === "BAD_REQUEST" ? "invalid_request" : "internal",
        );
      },
    );
    return () => {
      closed = true;
      controller.abort();
    };
  };
}
