// Purpose: Compiles a free-form stock research request into a WorkflowPart.
import { defineCommand } from "@openchart/server/agent/command/definition";
import type { AgentPromptPartInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { Effect, Schema } from "effect";

const multiAngleResearchArgs = Schema.Struct({
  question: Schema.String.check(Schema.isPattern(/\S/)),
});

/** Raw arguments preserve the stock, research context, quotes, and line breaks. */
export const multiAngleResearchCommand = defineCommand({
  name: "multi-angle-research",
  type: "workflow",
  description:
    "Research a stock from macro, sector, and company perspectives, then synthesize using your selected model",
  argumentHint:
    "Usage: <stock and optional research focus>. Example: NVDA over the next 12 months.",
  template: "$ARGUMENTS",
  buildParts: ({ captures }) =>
    Schema.decodeUnknownEffect(multiAngleResearchArgs)({
      question: captures.$ARGUMENTS,
    }).pipe(
      Effect.map((args) => [
        {
          type: "workflow",
          workflow: "default:workflows/multi-angle-research.workflow.ts",
          args,
        },
      ]),
    ),
  restoreArgumentsFromParts: Effect.fn("MultiAngleResearchCommand.restore")(
    function* (parts: readonly AgentPromptPartInput[]) {
      const [part] = parts;
      if (
        parts.length !== 1 ||
        part?.type !== "workflow" ||
        part.workflow !== "default:workflows/multi-angle-research.workflow.ts"
      )
        return undefined;
      const args = yield* Schema.decodeUnknownEffect(multiAngleResearchArgs)(
        part.args,
      );
      return args.question;
    },
  ),
});
