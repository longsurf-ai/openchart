// Purpose: Bars snapshots, updates, and capabilities share the scoped Hose boundary.

import { Effect, Schema, Stream } from "effect";
import { BarsChannelRequest, BarsMessage } from "@openchart/feed";
import { streamChannel } from "@openchart/server/lib/hose";
import { Feed } from "@openchart/server/feed/service";

const encodeMessage = Schema.encodeSync(BarsMessage);

/**
 * Handles Bars opens and capabilities using the connection's application context.
 *
 * bars.capabilities --------> capabilities array ----------------> done
 *
 * bars.open
 *   |
 *   +-- to: timestamp -----> snapshot --------------------------> done
 *   |
 *   +-- to: "now" ---------> snapshot --> updates --> updates --> ... --> done
 *                                                                       ^
 *                                                     source stream ends normally
 *
 * `done` is terminal: no further updates are sent on that channel.
 *
 * `snapshot` and `updates` are Bars response types, not Hose operations.
 * Hose carries each payload in a `data` message and reports failures with
 * `error`; caller cancellation closes the channel and stops source work.
 * @example hoseRouter.route('bars.open', barsChannel);
 */
export const barsChannel = streamChannel(
  { parse: Schema.decodeUnknownSync(BarsChannelRequest) },
  (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const services = yield* Feed;
        const feeds = yield* services.get();
        if (input.type === "bars.capabilities") {
          return Stream.succeed<unknown>(
            yield* feeds.bars.getCapabilities(input.request),
          );
        }
        const session = yield* feeds.bars.observe(input.request);
        const snapshot = Stream.succeed<unknown>(
          encodeMessage({
            type: "snapshot",
            snapshot: session.snapshot,
          }),
        );
        if (input.request.to !== "now") return snapshot;
        return Stream.concat(
          snapshot,
          // @agent invariant: provisioner dies when a live request has no updates.
          session.updates!.pipe(
            Stream.map((data) => encodeMessage({ type: "updates", data })),
          ),
        );
      }),
    ),
);
