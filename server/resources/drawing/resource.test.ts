// Purpose: Verify Drawing CRUD, validation and durable ownership through the actual Resource router.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Drawing } from "@openchart/chart-core/drawing/types";
import { ProviderId } from "@openchart/market";
import { router } from "@openchart/server";
import { makeRuntime } from "@openchart/server/runtime";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { ConfigProvider } from "effect";
import { expect, test } from "vitest";

test("annotation writes accept only epoch seconds, including label anchors, before persistence", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  const caller = router.createCaller({ runtime });
  try {
    const dashboard = await caller.resources.dashboard.create({
      name: "PANW research",
    });
    const body = {
      dashboardId: dashboard.id,
      provider: "yfinance",
      listing: { symbol: "PANW", currency: "USD" },
      data: Drawing.create("annotation", [], {
        time: 1775836800,
        title: "News",
        body: "Research",
        sources: [],
        sentiment: 0,
        labelAnchor: { time: 1775836800.125, price: 190 },
      }),
    };
    for (const time of [
      "2026-04-10",
      "2026-04-10T16:00:00Z",
      { year: 2026, month: 4, day: 10 },
      1775836800000,
    ]) {
      // Deliberately untrusted JSON, as sent by an Agent tool.
      await expect(
        caller.resources.drawing.create(
          JSON.parse(JSON.stringify({ ...body, data: { ...body.data, time } })),
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(
      (
        await caller.resources.drawing.list({
          filter: { dashboardId: dashboard.id },
        })
      ).items,
    ).toEqual([]);
    const saved = await caller.resources.drawing.create(body);
    for (const path of ["/data/time", "/data/labelAnchor/time"])
      await expect(
        caller.resources.drawing.patch({
          id: saved.id,
          expectedRevision: saved.revision,
          operations: [{ op: "replace", path, value: "2026-04-10" }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.resources.drawing.get({ id: saved.id })).toEqual(saved);
    expect(saved.data).toEqual(body.data);
  } finally {
    await runtime.dispose();
  }
});

test("drawings retain their data while generic bindings resolve Sessions", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  const caller = router.createCaller({ runtime });
  try {
    const dashboard = await caller.resources.dashboard.create({
      name: "Selection",
    });
    const drawing = await caller.resources.drawing.create({
      dashboardId: dashboard.id,
      provider: "yfinance",
      listing: { symbol: "AAPL", currency: "USD" },
      data: Drawing.create(
        "rectangle",
        [
          { time: 1000, price: 100 },
          { time: 2000, price: 110 },
        ],
        { id: "gesture" },
      ),
    });
    const key = `drawing:${drawing.id}`;
    expect(await caller.agent.getSessionByBinding({ key })).toBeNull();
    const session = await caller.agent.getOrCreateBoundSession({
      kind: "chart_explain",
      key,
      title: "Selection",
    });
    expect(await caller.agent.getSessionByBinding({ key })).toEqual(session);
    expect(
      await caller.agent.getOrCreateBoundSession({
        kind: "chart_explain",
        key,
      }),
    ).toEqual(session);
    expect(session.kind).toBe("chart_explain");
    const chat = await caller.agent.createSession({ title: "Chat" });
    expect(
      new Set((await caller.agent.listSessions({})).items.map(({ id }) => id)),
    ).toEqual(new Set([chat.id, session.id]));
    expect(await caller.resources.drawing.get({ id: drawing.id })).toEqual(
      drawing,
    );
    await expect(
      caller.resources.drawing.patch({
        id: drawing.id,
        expectedRevision: drawing.revision,
        operations: [{ op: "remove", path: "/data/anchors/1" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  } finally {
    await runtime.dispose();
  }
});

test("drawings survive restart, keep their own revisions and cascade only with their dashboard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openchart-drawings-"));
  const options = {
    home: directory,
    config: ConfigProvider.fromUnknown({}),
  };
  let runtime = makeRuntime(options);
  let caller = router.createCaller({ runtime });
  try {
    const dashboard = await caller.resources.dashboard.create({
      name: "Research",
    });
    const chart = await caller.resources.chart.create({
      dashboardId: dashboard.id,
    });
    const data: Drawing.Item = JSON.parse(
      JSON.stringify(
        Drawing.create("trend_line", [
          { time: 1, price: 100 },
          { time: 2, price: 110 },
        ]),
      ),
    );
    const drawing = await caller.resources.drawing.create({
      dashboardId: dashboard.id,
      provider: "yfinance",
      listing: { symbol: "AAPL", currency: "USD" },
      data,
    });
    const saved = await caller.resources.drawing.patch({
      id: drawing.id,
      expectedRevision: drawing.revision,
      operations: [{ op: "replace", path: "/data/style/lineWidth", value: 3 }],
    });
    expect(saved.revision).toBe(drawing.revision + 1);
    await expect(
      caller.resources.drawing.patch({
        id: drawing.id,
        expectedRevision: drawing.revision,
        operations: [{ op: "replace", path: "/data/hidden", value: true }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await caller.resources.chart.delete({ id: chart.id });
    await runtime.dispose();
    runtime = makeRuntime(options);
    caller = router.createCaller({ runtime });
    expect(await caller.resources.drawing.get({ id: saved.id })).toEqual(saved);
    expect(
      (
        await caller.resources.drawing.list({
          filter: {
            dashboardId: dashboard.id,
            provider: ProviderId.make("yfinance"),
          },
        })
      ).items,
    ).toEqual([saved]);
    expect(
      (
        await caller.resources.drawing.list({
          filter: {
            dashboardId: dashboard.id,
            provider: ProviderId.make("binance"),
          },
        })
      ).items,
    ).toEqual([]);
    await caller.resources.drawing.delete({ id: saved.id });
    expect(
      (
        await caller.resources.drawing.list({
          filter: { dashboardId: dashboard.id },
        })
      ).items,
    ).toEqual([]);
    await caller.resources.drawing.create({
      dashboardId: dashboard.id,
      provider: "yfinance",
      listing: saved.listing,
      data,
    });
    await caller.resources.dashboard.delete({ id: dashboard.id });
    expect(
      (
        await caller.resources.drawing.list({
          filter: { dashboardId: dashboard.id },
        })
      ).items,
    ).toEqual([]);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects unfinished geometry and undeclared fields at the Resource boundary", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  const caller = router.createCaller({ runtime });
  try {
    const dashboard = await caller.resources.dashboard.create({
      name: "Research",
    });
    const body = {
      dashboardId: dashboard.id,
      provider: "yfinance",
      listing: { symbol: "AAPL", currency: "USD" },
      data: Drawing.create("trend_line", [
        { time: 1, price: 100 },
        { time: 2, price: 110 },
      ]),
    };
    await expect(
      caller.resources.drawing.create({
        ...body,
        data: { ...body.data, anchors: [] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.resources.drawing.create({
        ...body,
        data: { ...body.data, style: { ...body.data.style, opacity: 2 } },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const undeclared = { ...body, data: { ...body.data, draft: true } };
    await expect(
      caller.resources.drawing.create(undeclared),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (
        await caller.resources.drawing.list({
          filter: { dashboardId: dashboard.id },
        })
      ).items,
    ).toEqual([]);

    const saved = await caller.resources.drawing.create(body);
    for (const operations of [
      [{ op: "replace", path: "/data/anchors", value: [] }],
      [{ op: "replace", path: "/data/id", value: "" }],
      [{ op: "replace", path: "/data/style/opacity", value: 2 }],
      [{ op: "add", path: "/data/draft", value: true }],
    ] as const) {
      await expect(
        caller.resources.drawing.patch({
          id: saved.id,
          expectedRevision: saved.revision,
          operations: [...operations],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await caller.resources.drawing.get({ id: saved.id })).toEqual(saved);
  } finally {
    await runtime.dispose();
  }
});
