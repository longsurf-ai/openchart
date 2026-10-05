// Purpose: Verifies the stock research command's parallel fan-out, labeled synthesis, and parent model inheritance.

import { buildCommand } from "@openchart/server/agent/command/command";
import type { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { CLAUDE_CODE, CODEX, TIER4 } from "@openchart/models/model-tiers";
import { Deferred, Effect } from "effect";
import { expect, test } from "vitest";
import { defaultWorkflowFixture } from "./defaults.test-utils";
import { run } from "./runtime";
import { Workflow } from "./workflow";

const loadDefaultWorkflow = defaultWorkflowFixture();

test.each<{
  model: AgentPromptInput["model"];
  failedAngles: string[];
}>([
  {
    model: { providerID: CODEX, modelID: TIER4, selectedVariant: "high" },
    failedAngles: [],
  },
  {
    model: { providerID: CLAUDE_CODE, modelID: TIER4 },
    failedAngles: ["sector"],
  },
  {
    model: { providerID: CODEX, modelID: TIER4 },
    failedAngles: ["macro", "sector", "company"],
  },
])(
  "researches three angles before synthesis with $model.providerID and failures $failedAngles",
  async ({ model, failedAngles }) => {
    const question =
      "Research NVDA's opportunities and risks over the next year";
    const angles = ["macro", "sector", "company"];
    const research = angles.map((angle, index) => ({
      angle,
      ...(failedAngles.includes(angle)
        ? {
            status: "error",
            error: { name: "Error", message: `${angle} unavailable` },
          }
        : {
            status: "success",
            value: { sessionId: `child-${index}`, output: `${angle} evidence` },
          }),
    }));
    const prompts: AgentPromptInput[] = [];
    let settled = 0;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const parts = yield* buildCommand({
          command: "multi-angle-research",
          arguments: question,
        });
        const part = parts[0]!;
        if (part.type !== "workflow") return yield* Effect.die("No workflow");
        const definition = yield* loadDefaultWorkflow(part.workflow);
        const allStarted = yield* Deferred.make<void>();
        return yield* run(definition, part.args).pipe(
          Effect.provideService(Workflow.Service, {
            parentPrompt: { agent: "analyst", model, parts },
            settings: { concurrency: 3 },
            agent: (input, onSession, options) =>
              Effect.gen(function* () {
                const index = prompts.length;
                prompts.push(input);
                expect(input.model).toEqual(model);
                expect(input.agent).toBe("analyst");
                expect(options?.sessionId).toBeUndefined();
                const text = input.parts.find(
                  (part) => part.type === "text",
                )!.text;
                expect(text).toContain(question);
                yield* onSession(`child-${index}`);

                if (index === 3) {
                  expect(settled).toBe(3);
                  expect(text).toContain(JSON.stringify(research));
                  return {
                    sessionId: "child-3",
                    output: "Combined assessment",
                  };
                }

                const angle = angles[index]!;
                expect(text).toContain(`Research angle: ${angle}`);
                // No researcher can finish until all three have started.
                if (prompts.length === 3)
                  yield* Deferred.succeed(allStarted, undefined);
                yield* Deferred.await(allStarted);
                settled++;
                if (failedAngles.includes(angle))
                  return yield* Effect.fail(new Error(`${angle} unavailable`));
                return {
                  sessionId: `child-${index}`,
                  output: `${angle} evidence`,
                };
              }),
          }),
        );
      }),
    );

    expect(prompts).toHaveLength(4);
    expect(result).toEqual({
      question,
      research,
      summary: { sessionId: "child-3", output: "Combined assessment" },
    });
  },
);
