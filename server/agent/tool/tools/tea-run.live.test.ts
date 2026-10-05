// Purpose: Opt-in real-model proof that an Agent can test and repair Tea using sample feedback.
import { symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { CODEX, TIER1 } from "@openchart/models/model-tiers";
import { AgentRunStore } from "@openchart/server/agent/run/store";
import { Session } from "@openchart/server/agent/session";
import { submitPrompt } from "@openchart/server/agent/session/submit-prompt";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Models } from "@openchart/server/models";
import { makeRuntime } from "@openchart/server/runtime";
import { assertExists } from "@openchart/utils/assert";
import { Parameters } from "./tea-run";

const runtimes = process.env.OPENCHART_TEA_LIVE_RUNTIME_DIR;
const reportPath = process.env.OPENCHART_TEA_LIVE_REPORT;
const draft = [
  'threshold = input.float(100, "Threshold")',
  'alertcondition("cross", close > threshold, "Cross", "Price crossed above threshold")',
  'emit "price" close',
].join("\n");
const prompt = `This is a Tea behavior verification. Actually use tea_check/tea_run; do not just reason about it or claim the test passed.
Use only these two tools: do not read or write files, do not read real market data, and do not create alerts or publish content.

Requirement: when each 1-minute bar closes, if the close goes from not above 100 to above 100, emit one cross event.
Staying above 100, breaking down below 100, and being exactly equal to 100 must not fire. Keep the cross output column.
Here is a draft to verify:
\`\`\`tea
${draft}
\`\`\`

First write the expected result for each bar, then run the draft unchanged and keep the real tool feedback from that run.
Based on the actual results, find where it does not meet the requirement, modify the Tea, and rerun with the same samples until the behavior matches the expectation.
The sample closes, in order, are [99, 101, 102, 99, 100, 101].
The times, in order, are [60000, 120000, 180000, 240000, 300000, 360000] milliseconds.
Each bar's open/high/low equals its close, every volume is 1, all bars are already closed, and there is no earlier history.
The sample run window is from=60000, to=420000.
Use yfinance, AAPL, USD, 1m, regular, split as the input context, only as sample metadata.
Finally, report the actual fire times of the draft and of the fixed version, the per-bar check results, and the final complete code.`;

test.runIf(Boolean(runtimes))(
  "real Agent tests a wrong Tea draft, observes false positives, and repairs it",
  async () => {
    assertExists(runtimes, "Opt-in smoke requires installed native runtimes");
    const home = temporaryHome();
    symlinkSync(path.resolve(runtimes), path.join(home, "model-providers"));
    const runtime = makeRuntime({
      home,
      databasePath: ":memory:",
      models: { fetchEnabled: false },
    });
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const models = yield* Models.Service;
          const selected = yield* models.getModel(CODEX, TIER1);
          const session = yield* Session.Service;
          const root = yield* session.create({
            title: "Tea sample feedback live smoke",
          });
          const runs = yield* AgentRunStore.Service;
          const accepted = yield* submitPrompt({
            sessionID: root.id,
            sessionIntentID: "tea-sample-feedback",
            input: {
              agent: "analyst",
              model: { providerID: CODEX, modelID: TIER1 },
              parts: [{ type: "text", text: prompt }],
            },
          });
          console.info("Tea live started", {
            sessionID: root.id,
            model: selected.id,
          });
          let previous = "";
          while (true) {
            const run = yield* runs.get(accepted.id);
            assertExists(run, "Submitted Run must exist");
            const { history } = yield* session.readTranscriptPage({
              sessionID: root.id,
              turnLimit: 10,
            });
            const transcript = history.map(({ info, parts }) => ({
              role: info.role,
              parts: parts.filter(
                (part) => part.type === "text" || part.type === "tool",
              ),
            }));
            const tools = history
              .flatMap(({ parts }) => parts)
              .filter((part) => part.type === "tool");
            const summary = tools.map((part) => ({
              tool: part.tool,
              status: part.state.status,
            }));
            const signature = JSON.stringify({
              status: run.status,
              tools: summary,
            });
            if (signature !== previous) {
              previous = signature;
              console.info("Tea live progress", {
                status: run.status,
                tools: summary,
              });
            }
            if (reportPath)
              writeFileSync(
                reportPath,
                JSON.stringify(
                  {
                    provider: CODEX,
                    model: selected.id,
                    sessionID: root.id,
                    status: run.status,
                    transcript,
                  },
                  null,
                  2,
                ),
              );
            if (run.status === "queued" || run.status === "running") {
              yield* Effect.sleep("1 second");
              continue;
            }
            expect(run.status).toBe("completed");
            expect(
              tools.every(
                (part) => part.tool === "tea_check" || part.tool === "tea_run",
              ),
            ).toBe(true);
            const successfulRuns = tools.flatMap((part) => {
              if (
                part.tool !== "tea_run" ||
                part.state.status !== "completed" ||
                part.state.output.type !== "json"
              )
                return [];
              const args = Schema.decodeUnknownSync(Parameters)(
                part.state.input,
              );
              const value = Schema.decodeUnknownSync(
                Schema.Struct({
                  status: Schema.String,
                  rows: Schema.optionalKey(
                    Schema.Array(
                      Schema.Struct({
                        time: Schema.Number,
                        cross: Schema.Array(Schema.Json),
                      }),
                    ),
                  ),
                }),
              )(part.state.output.value);
              if (value.status !== "ok") return [];
              assertExists(value.rows, "Successful run must return rows");
              // The run reads the requested bars from one Samples input.
              const samples = Object.values(args.config.inputs).flatMap(
                (input) => (input._tag === "Samples" ? [input] : []),
              );
              expect(
                samples.map((input) => input.rows.map((row) => row.close)),
              ).toEqual([[99, 101, 102, 99, 100, 101]]);
              return [
                {
                  source: args.source,
                  fired: value.rows
                    .filter((row) => row.cross.length > 0)
                    .map((row) => row.time),
                },
              ];
            });
            expect(successfulRuns.length).toBeGreaterThanOrEqual(2);
            expect(successfulRuns[0]!.source?.trim()).toBe(draft);
            expect(successfulRuns[0]!.fired).toEqual([120000, 180000, 360000]);
            expect(successfulRuns.at(-1)!.source).not.toBe(
              successfulRuns[0]!.source,
            );
            expect(successfulRuns.at(-1)!.fired).toEqual([120000, 360000]);
            console.info("Tea live verified", {
              model: selected.id,
              successfulRuns,
            });
            break;
          }
        }).pipe(Effect.timeout("4 minutes")),
      );
    } finally {
      await runtime.dispose();
    }
  },
  270_000,
);
