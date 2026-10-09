// Purpose: Exercise saved selection, finite Feed data, and prompt context through the real Agent bridge.

import { Drawing } from "@openchart/chart-core/drawing/types";
import type { BarsRequest, BarsSnapshot } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { Feed } from "@openchart/server/feed/service";
import { Plugin } from "@openchart/server/agent/plugin";
import { PluginRegistry } from "@openchart/server/agent/plugin/registry";
import { execute } from "@openchart/server/agent/prompt/execute";
import { run } from "@openchart/server/agent/prompt/prompt.test-utils";
import { Transactor } from "@openchart/server/lib/resource";
import { dashboardResource } from "@openchart/server/resources/dashboard";
import { drawingResource } from "@openchart/server/resources/drawing";
import { fromPoints } from "@openchart/timeseries";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { chartExplainPlugin } from "./chart-explain";

const firstTime = 1_700_000_000_000;
const day = 86_400_000;
const times = Array.from({ length: 5 }, (_, index) => firstTime + index * day);
const rows = [98, 100, 110, 105, 112].map((close, index) => {
  const open = index === 0 ? 98 : [100, 100, 110, 105][index - 1]!;
  return {
    time: times[index]!,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 100 + index,
  };
});
const snapshot = {
  range: { from: times[0]!, to: times[4]! + 1 },
  data: fromPoints({}, rows),
  hasMoreBefore: false,
} as BarsSnapshot;

test("prepares selected OHLC waves and an annotation task before model I/O", async () => {
  const requests: BarsRequest[] = [];
  const feed = Feed.of({
    get: () =>
      Effect.succeed({
        bars: {
          observe: (request: BarsRequest) =>
            Effect.sync(() => {
              requests.push(request);
              return { snapshot };
            }),
          getCapabilities: () => Effect.succeed([]),
        },
        symbology: undefined!,
        logos: undefined!,
        series: undefined!,
        calendar: undefined!,
      }),
    getVersion: () => Effect.die("Unexpected Feed version access"),
  });
  await run((fixture) =>
    Effect.gen(function* () {
      const dashboard = yield* Transactor.run(
        dashboardResource.transitions.create(
          Schema.decodeUnknownSync(dashboardResource.createSchema)({
            name: "Selection",
          }),
        ),
      );
      const drawing = yield* Transactor.run(
        drawingResource.transitions.create({
          dashboardId: dashboard.id,
          provider: Schema.decodeUnknownSync(ProviderId)("yfinance"),
          listing: { symbol: "AAPL", currency: "USD" },
          data: Schema.decodeUnknownSync(Drawing.AgentSessionItem)({
            id: "selected-range",
            type: "agent_session",
            anchors: [],
            range: { from: times[1]!, to: times[4]! },
            style: { lineColor: "#55aaff" },
            locked: true,
          }),
        }),
      );
      const session = yield* fixture.session.getOrCreateBound({
        key: `drawing:${drawing.id}`,
        kind: "chart_explain",
      });
      fixture.run.sessionID = session.id;
      fixture.run.input.parts = [
        {
          type: "plugin_input",
          input: {
            type: "chart_explain",
            drawingId: drawing.id,
            resolution: "1d",
            session: "regular",
            adjustment: "split",
          },
        },
      ];
      const plugin = yield* Plugin.bind(chartExplainPlugin).pipe(
        Effect.provideService(Feed, feed),
      );
      yield* execute(fixture.run).pipe(
        Effect.provide(PluginRegistry.layer([plugin])),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        provider: "yfinance",
        listing: { symbol: "AAPL" },
        resolution: "1d",
        session: "regular",
        adjustment: "split",
        from: times[1],
        to: times[4]! + 1,
        countBack: 1,
      });
      const messages = yield* fixture.session.listMessages({
        sessionID: session.id,
        limit: 100,
      });
      const contexts = messages.items.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "context" && part.context.kind === "plugin"
            ? [part.context.content]
            : [],
        ),
      );
      expect(contexts).toHaveLength(1);
      const prompt = contexts[0]!;
      expect(prompt).toContain("AAPL");
      expect(prompt).toContain("100.00 open -> 112.00 close (+12.00%)");
      expect(prompt).toContain("-4.55%");
      expect(prompt).toContain("Workflow:");
      expect(prompt).toContain("research one material move at a time");
      expect(prompt).toContain("save its annotation immediately");
      expect(prompt).toContain("Review discipline:");
      expect(prompt).toContain("research leads only");
      expect(prompt).toContain("title must state its event");
      expect(prompt).toContain("Do not open with an OHLC summary");
      expect(prompt).toContain(
        "Create one annotation Drawing per distinct warranted event",
      );
      expect(prompt).toContain("Zero annotations is a valid outcome");
      expect(prompt).toContain("event's verified public time");
      expect(prompt).toContain("data.sources");
      expect(prompt).toContain("sentiment from the nearby observed reaction");
      expect(prompt).toContain(`chart-explain:${drawing.data.id}:event:`);
      expect(prompt).not.toContain("Save exactly one annotation");
      expect(prompt).not.toContain("Fallback annotation data.time");
      expect(prompt).not.toContain("include_schema");
      expect(prompt).not.toContain("expected_revision");
      expect(prompt).not.toContain("nextCursor");
      expect(prompt).not.toContain("fictional");
      expect(JSON.stringify(fixture.calls[0]!.prompt)).toContain("+12.00%");
    }),
  );
});

test("ordinary prompts do not read Feed or contribute a selection context", async () => {
  await run((fixture) =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.bind(chartExplainPlugin);
      yield* execute(fixture.run).pipe(
        Effect.provide(PluginRegistry.layer([plugin])),
      );
      const messages = yield* fixture.session.listMessages({
        sessionID: fixture.run.sessionID,
        limit: 100,
      });
      expect(
        messages.items.flatMap((message) =>
          message.parts.filter((part) => part.type === "context"),
        ),
      ).toEqual([]);
    }),
  );
});
