// Purpose: Send one scoped Tea snapshot followed by its optional live output.
import { Effect, Schema, Stream } from "effect";

import { streamChannel } from "@openchart/server/lib/hose";
import * as Tea from "./tea";

const encode = Schema.encodeSync(Tea.Message);

/** The shared channel adapter owns cancellation, encoding errors and completion. */
export const teaChannel = streamChannel(
  { parse: Schema.decodeUnknownSync(Tea.ChannelRequest) },
  ({ request }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const tea = yield* Tea.Service;
        const { rid, config, snapshot, updates } = yield* tea.observe(request);
        return Stream.concat(
          Stream.succeed(encode({ type: "snapshot", rid, config, snapshot })),
          (updates ?? Stream.empty).pipe(
            Stream.map((data) => encode({ type: "updates", data })),
          ),
        );
      }),
    ),
);
