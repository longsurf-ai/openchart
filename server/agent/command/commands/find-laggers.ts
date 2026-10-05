// Purpose: Compiles an event research request into the laggard-finding workflow.
import { defineCommand } from "@openchart/server/agent/command/definition";
import type { AgentPromptPartInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { Effect, Schema } from "effect";

const findLaggersArgs = Schema.Struct({
  request: Schema.String.check(Schema.isPattern(/\S/)),
});

/** Preserves the event request, including quotes and line breaks, when editing. */
export const findLaggersCommand = defineCommand({
  name: "find-laggers",
  type: "workflow",
  description:
    "Find potential laggards benefiting from a stock's catalyst, with business evidence and price checks",
  argumentHint:
    "Usage: <stock move or event, optional market and horizon>. Example: NVDA rallied after earnings; find US downstream laggards.",
  template: "$ARGUMENTS",
  buildParts: ({ captures }) =>
    Schema.decodeUnknownEffect(findLaggersArgs)({
      request: captures.$ARGUMENTS,
    }).pipe(
      Effect.map((args) => [
        {
          type: "workflow",
          workflow: "default:workflows/find-laggers.workflow.ts",
          args,
        },
      ]),
    ),
  restoreArgumentsFromParts: Effect.fn("FindLaggersCommand.restore")(function* (
    parts: readonly AgentPromptPartInput[],
  ) {
    const [part] = parts;
    if (
      parts.length !== 1 ||
      part?.type !== "workflow" ||
      part.workflow !== "default:workflows/find-laggers.workflow.ts"
    )
      return undefined;
    const args = yield* Schema.decodeUnknownEffect(findLaggersArgs)(part.args);
    return args.request;
  }),
});
