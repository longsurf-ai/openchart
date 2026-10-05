// Purpose: Verifies Feed execution evidence comes from accepted Runs and published analyses, not mutable Triggers.
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";
import { AgentRunStore } from "@openchart/server/agent/run/store";
import { Session } from "@openchart/server/agent/session";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Transactor } from "@openchart/server/lib/resource";
import { alertEventResource } from "@openchart/server/resources/alert-event";
import {
  alertRuleResource,
  AlertableDefinition,
} from "@openchart/server/resources/alert-rule";
import { barsRuleConfig } from "@openchart/server/resources/alert-rule/alert-rule.test-utils";
import { publishPost } from "@openchart/server/resources/post";
import { triggerResource } from "@openchart/server/resources/trigger";
import { makeRuntime } from "@openchart/server/runtime";
import {
  alertIntent,
  alertPostForIntent,
  feedExecutions,
} from "./post-context";

let runtime: ReturnType<typeof makeRuntime>;
beforeEach(() => {
  runtime = makeRuntime({ home: temporaryHome(), databasePath: ":memory:" });
});
afterEach(() => runtime.dispose());
const prompt = {
  agent: "analyst",
  model: { providerID: "codex" as const, modelID: "tier1" as const },
  parts: [{ type: "text" as const, text: "Review." }],
};

test("retains execution and publication evidence after Trigger edits/deletion and Rule deletion", async () => {
  expect(alertIntent("schedule:one")).toBeNull();
  expect(alertIntent("trigger:trg_one:ale_one")).toEqual({
    triggerId: "trg_one",
    eventId: "ale_one",
  });
  expect(() => alertIntent("trigger:trg_one:ale_one:extra")).toThrow();
  await runtime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service;
      const runs = yield* AgentRunStore.Service;
      const rule = yield* Transactor.run(
        alertRuleResource.transitions.create({
          name: "Retained history",
          enabled: false,
          repeat: true,
          alertable: Schema.decodeUnknownSync(AlertableDefinition)({
            kind: "tea",
            source: "close",
            config: barsRuleConfig({
              provider: "yfinance",
              listing: { symbol: "AAPL", currency: "USD" },
              resolution: "1m",
              session: "regular",
              adjustment: "raw",
            }),
          }),
        }),
      );
      const event = yield* Transactor.run(
        alertEventResource.transitions.create({
          ruleId: rule.id,
          condition: "crossing",
          time: 100,
          detail: { title: "Crossed", message: "AAPL above 200", data: {} },
        }),
      );
      const original = yield* Transactor.run(
        publishPost({
          publicationKey: `event:${event.id}`,
          author: { kind: "rule", ruleId: rule.id, name: rule.name },
          origin: {
            kind: "alert_event",
            eventId: event.id,
            ruleId: rule.id,
            occurredAt: event.time,
          },
          content: [{ type: "text", text: "AAPL above 200" }],
          quotedPostId: null,
        }),
      );
      const firstTrigger = yield* Transactor.run(
        triggerResource.transitions.create({
          name: "Original Codex action",
          enabled: false,
          event: { kind: "alert", ruleId: rule.id },
          target: { kind: "agent_prompt", prompt },
        }),
      );
      const secondTrigger = yield* Transactor.run(
        triggerResource.transitions.create({
          name: "Original Claude action",
          enabled: false,
          event: { kind: "alert", ruleId: rule.id },
          target: {
            kind: "agent_prompt",
            prompt: {
              ...prompt,
              model: { providerID: "claude-code", modelID: "tier1" },
            },
          },
        }),
      );
      const firstSession = yield* sessions.create({
        title: "Accepted Codex Session",
      });
      const secondSession = yield* sessions.create({
        title: "Accepted Claude Session",
      });
      const first = yield* runs.enqueue({
        sessionID: firstSession.id,
        sessionIntentID: `trigger:${firstTrigger.id}:${event.id}`,
        input: prompt,
      });
      yield* runs.claim(firstSession.id);
      const second = yield* runs.enqueue({
        sessionID: secondSession.id,
        sessionIntentID: `trigger:${secondTrigger.id}:${event.id}`,
        input: {
          ...prompt,
          model: { providerID: "claude-code", modelID: "tier1" },
        },
      });
      yield* runs.claim(secondSession.id);
      yield* Transactor.run(
        publishPost({
          publicationKey: "tool:first:note",
          author: { kind: "provider", providerId: "codex" },
          origin: {
            kind: "agent_run",
            runId: first.id,
            sessionId: firstSession.id,
            alert: { eventId: event.id, ruleId: rule.id },
          },
          content: [{ type: "text", text: "Still researching." }],
          quotedPostId: original.id,
        }),
      );
      yield* Transactor.run(
        publishPost({
          publicationKey: "tool:second:analysis",
          author: { kind: "provider", providerId: "claude-code" },
          origin: {
            kind: "agent_run",
            runId: second.id,
            sessionId: secondSession.id,
            alert: { eventId: event.id, ruleId: rule.id },
          },
          content: [{ type: "text", text: "Final conclusion." }],
          quotedPostId: original.id,
        }),
      );
      yield* runs.complete(first.id);
      // A normal chat intent sharing the event suffix must not become an Alert execution.
      yield* runs.enqueue({
        sessionID: firstSession.id,
        sessionIntentID: `chat:${event.id}`,
        input: prompt,
      });
      yield* Transactor.run(
        triggerResource.transitions.patch({
          id: firstTrigger.id,
          expectedRevision: firstTrigger.revision,
          operations: [
            { op: "replace", path: "/name", value: "Edited after admission" },
            {
              op: "replace",
              path: "/target",
              value: {
                kind: "notification",
                message: "Now only a notification",
              },
            },
          ],
        }),
      );
      yield* Transactor.run(
        triggerResource.transitions.remove(secondTrigger.id),
      );
      yield* Transactor.run(alertRuleResource.transitions.remove(rule.id));
      expect(yield* alertPostForIntent(first.sessionIntentID)).toEqual(
        original,
      );
      expect(yield* alertPostForIntent("chat:ordinary")).toBeNull();
      const executions = yield* feedExecutions([event.id]);
      expect(executions).toHaveLength(1);
      expect(executions[0]?.runs).toHaveLength(2);
      expect(executions[0]?.runs).toEqual(
        expect.arrayContaining([
          {
            runId: first.id,
            sessionId: firstSession.id,
            title: "Accepted Codex Session",
            providerId: "codex",
            status: "completed",
            triggerId: firstTrigger.id,
            canEditPrompt: false,
            hasPublished: true,
          },
          {
            runId: second.id,
            sessionId: secondSession.id,
            title: "Accepted Claude Session",
            providerId: "claude-code",
            status: "running",
            triggerId: secondTrigger.id,
            canEditPrompt: false,
            hasPublished: true,
          },
        ]),
      );
      yield* runs.complete(second.id);
      expect(
        (yield* feedExecutions([event.id]))[0]?.runs.find(
          (run) => run.runId === second.id,
        ),
      ).toMatchObject({ status: "completed", hasPublished: true });
      expect(yield* feedExecutions([])).toEqual([]);
    }),
  );
});
