// Purpose: Serializes the existing model-history projection for transcript reads and search.

import type { WithParts } from "@openchart/server/agent/contracts/message";
import { pruneMessages } from "ai";
import { Effect } from "effect";
import { toModelMessages } from "./to-model-messages";

/**
 * Serializes one committed message's model history as JSON, without reasoning.
 * Uses its recorded model; replay owns context, tools, media, and error handling.
 * Synthetic text stays in model history. Empty projections serialize as `[]`.
 * The caller retains the stored message ID and selects whole Parts. Does not mutate
 * the message; model projection failures, including missing evidence, remain defects.
 * @example
 * const content = yield* transcriptText(message);
 */
export const transcriptText = Effect.fn("transcriptText")(function* (
  message: WithParts,
) {
  const model =
    message.info.role === "user" ? message.info.model : message.info;
  return JSON.stringify(
    pruneMessages({
      messages: yield* toModelMessages([message], {
        providerID: model.providerID,
        id: model.modelID,
      }),
      reasoning: "all",
    }),
    null,
    2,
  );
});
