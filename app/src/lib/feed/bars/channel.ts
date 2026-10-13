// Purpose: Validate snapshot/update ordering and own one channel's retained view.
import {
  ClientFailures,
  type BarsMessage,
  type BarsRequest,
} from "@openchart/feed";
import { Match, Option } from "effect";
import type { BarsView } from "../contracts";
import { createBarsReplay } from "./replay";

/** One subscription's state machine; closing it also completes its retained updates. @internal */
export function createBarsChannel(request: BarsRequest) {
  const replay = createBarsReplay(request.provider);
  let current = Option.none<BarsView>();

  const receive = Match.type<BarsMessage>().pipe(
    Match.discriminatorsExhaustive("type")({
      snapshot: ({ snapshot }) => {
        if (Option.isSome(current))
          throw new ClientFailures.InvalidResponse({
            issue: "duplicate-bars-snapshot",
          });
        current = Option.some(
          Object.freeze({
            ...snapshot,
            request,
            range: Object.freeze({ ...snapshot.range }),
            updates: replay.updates,
          }),
        );
        return current;
      },
      updates: ({ data }) => {
        if (Option.isNone(current))
          throw new ClientFailures.InvalidResponse({
            issue: "bars-updates-before-snapshot",
          });
        if (request.to !== "now")
          throw new ClientFailures.InvalidResponse({
            issue: "bars-updates-for-history",
          });
        replay.next(data);
        return Option.none<BarsView>();
      },
    }),
  );

  return {
    receive,
    finish() {
      if (Option.isNone(current)) throw new ClientFailures.InvalidResponse();
    },
    fail: replay.error,
    close: replay.complete,
  };
}
