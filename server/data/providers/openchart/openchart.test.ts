// Purpose: Verify OpenChart Arrow pagination, Feed composition, search identity and real Tea alerts.
import { once } from "node:events";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Effect, Fiber, ConfigProvider, Stream, Schema } from "effect";
import { expect, test, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import {
  OpenChartResolution,
  OpenChartAdjustment,
} from "@openchart/server/data/providers/openchart/contract";
import { BarsRequest, BarsSeries } from "@openchart/feed";
import { Feed } from "@openchart/server/feed/service";
import { OpenChartClient } from "./client";
import { makeRuntime } from "@openchart/server/runtime";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { jweEncryption } from "@openchart/server/access/credential/encryption";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
import { router } from "@openchart/server";
import { TeaAlerts } from "@openchart/server/alert/tea-alerts";
import { Monitoring } from "@openchart/server/monitoring";
import * as Tea from "@openchart/tea";
import { selectBars } from "@openchart/server/data/providers/openchart/datasets/bars";

import type { Bar } from "./contract";
import { arrow, bar, listing, capabilities } from "./client.test-utils";
async function fixture(rows: readonly Bar[], initial?: Bar, resolution = "1m") {
  const queries: URL[] = [];
  let status = 200;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    queries.push(url);
    if (url.pathname === "/billing/subscription") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ status: "none" }));
    }
    res.statusCode = status;
    if (status !== 200) return res.end();
    if (url.pathname === "/marketfeed/capabilities") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(capabilities));
    }
    if (url.pathname === "/symbology/search") {
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          results: [
            listing,
            { ...listing, id: 5, symbol: "ABC", class: "fund" },
          ],
        }),
      );
    }
    const start = Number(url.searchParams.get("start")),
      end = Number(url.searchParams.get("end")),
      limit = Number(url.searchParams.get("limit"));
    if (start < 0 || end <= start) {
      res.statusCode = 400;
      return res.end();
    }
    let selected = rows.filter((row) => row.time >= start && row.time < end);
    if (url.searchParams.get("order") === "desc")
      selected = [...selected].reverse();
    res.setHeader("Content-Type", "application/vnd.apache.arrow.stream");
    res.end(arrow(selected.slice(0, limit)));
  });
  const ws = new WebSocketServer({ server, path: "/marketfeed/live" });
  const subscriptions = new Map<
    WebSocket,
    Map<
      string,
      {
        listing: number;
        resolution: string;
        adjustment: string;
        session: string;
      }
    >
  >();
  const commands: Array<{
    type: string;
    id: string;
    series?: {
      listing: number;
      resolution: string;
      adjustment: string;
      session: string;
    };
  }> = [];
  const send = (value: Bar) => {
    for (const [socket, entries] of subscriptions)
      for (const [id, series] of entries)
        socket.send(
          JSON.stringify({
            type: "bar",
            id,
            listing: series.listing,
            resolution: series.resolution,
            bar: value,
          }),
        );
  };
  ws.on("connection", (socket, request) => {
    queries.push(new URL(request.url!, "http://localhost"));
    const entries = new Map();
    subscriptions.set(socket, entries);
    socket.on("close", () => subscriptions.delete(socket));
    socket.on("message", (data) => {
      const command = JSON.parse(data.toString());
      commands.push(command);
      if (command.type === "unsubscribe") {
        entries.delete(command.id);
        return;
      }
      entries.set(command.id, command.series);
      socket.send(JSON.stringify({ type: "subscribed", id: command.id }));
      if (initial)
        socket.send(
          JSON.stringify({
            type: "bar",
            id: command.id,
            listing: command.series.listing,
            resolution: command.series.resolution,
            bar: initial,
          }),
        );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    credentialEncryption: jweEncryption(randomBytes(32)),
    auth: { integrationID: OPENCHART_CLOUD.integrationID },
    billing: { baseUrl: `http://127.0.0.1:${address.port}` },
    integrations: { methods: [OPENCHART_CLOUD] },
    config: ConfigProvider.fromUnknown({
      openchart: { baseUrl: `http://127.0.0.1:${address.port}` },
      providers: { binance: { enabled: false }, yfinance: { enabled: false } },
    }),
    models: { fetchEnabled: false, userAgent: "test" },
  });
  const caller = router.createCaller({ runtime });
  await caller.access.auth.completeSignIn({
    apiKeyID: "ak_test",
    key: "test-key",
    user: {
      id: "test-user",
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
    },
  });
  const feed = await runtime.runPromise(Feed);
  await vi.waitFor(async () => {
    const current = await runtime.runPromise(feed.get());
    expect(
      await runtime.runPromise(
        current.bars.getCapabilities({
          provider: Schema.decodeUnknownSync(BarsSeries)({
            provider: "openchart",
            listing,
            resolution,
            session: "regular",
            adjustment: "raw",
          }).provider,
          listing,
        }),
      ),
    ).not.toEqual([]);
  });
  return {
    runtime,
    caller,
    feed,
    queries,
    commands,
    ws,
    send,
    setInitial: (value: Bar) => {
      initial = value;
    },
    setStatus: (value: number) => {
      status = value;
    },
    close: async () => {
      await runtime.dispose();
      for (const socket of ws.clients) socket.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
const series = Schema.decodeUnknownSync(BarsSeries)({
  provider: "openchart",
  listing,
  resolution: "1m",
  session: "regular",
  adjustment: "raw",
});
test("ready Dataset shares history between Feed consumers and isolates complete series keys", async () => {
  const rows = Array.from({ length: 2000 }, (_, i) => bar(i + 1));
  const f = await fixture(rows);
  try {
    const services = await f.runtime.runPromise(f.feed.get());
    const request = { ...series, from: 1000, to: 1500, countBack: 500 };
    const observe = (input: typeof request) =>
      f.runtime.runPromise(Effect.scoped(services.bars.observe(input)));
    const first = (await observe(request)).snapshot;
    for (let i = 0; i < 19; i++)
      expect((await observe(request)).snapshot).toEqual(first);
    const requests = () =>
      f.queries.filter((q) => q.pathname.endsWith("arrow"));
    expect(requests()).toHaveLength(2);
    for (const selection of [
      { session: "extended" as const },
      { resolution: "1d" as const },
      { adjustment: "split" as const },
    ])
      await observe({ ...request, ...selection });
    expect(requests()).toHaveLength(8);
    await observe({ ...request, from: 3000, to: 4000, countBack: 10 });
    const before = requests().length;
    expect((await observe(request)).snapshot).toEqual(first);
    expect(requests()).toHaveLength(before);
    await f.caller.providers.refresh();
    await vi.waitFor(async () => {
      const current = await f.runtime.runPromise(f.feed.get());
      expect(current).not.toBe(services);
      expect(
        await f.runtime.runPromise(current.bars.getCapabilities(series)),
      ).not.toEqual([]);
    });
    await expect(observe(request)).rejects.toMatchObject({
      reason: { _tag: "Feed.Reconfigured", provider: "openchart" },
    });
    const refreshed = await f.runtime.runPromise(f.feed.get());
    const next = await f.runtime.runPromise(
      Effect.scoped(refreshed.bars.observe(request)),
    );
    expect(next.snapshot).toEqual(first);
    expect(requests()).toHaveLength(before + 2);
  } finally {
    await f.close();
  }
});

test("history paginates forwards and backwards without fabricating missing bars", async () => {
  const rows = Array.from({ length: 10005 }, (_, i) => bar(1000 + i * 2000));
  const f = await fixture(rows);
  try {
    const client = await f.runtime.runPromise(OpenChartClient);
    const key = {
      listing: listing.id,
      session: "regular" as const,
      resolution: "1m" as const,
      adjustment: "raw" as const,
    };
    const forward = await f.runtime.runPromise(
      selectBars(client, { ...key, time: { from: 0, to: 30000000 } }),
    );
    expect(forward.numRows).toBe(10005);
    expect(forward.get(10004)?.time).toBe(rows[10004]!.time);
    const backward = await f.runtime.runPromise(
      selectBars(client, { ...key, time: { to: 30000000 }, count: 10002 }),
    );
    expect(backward.numRows).toBe(10002);
    expect(backward.get(0)?.time).toBe(rows[3]!.time);
    expect(f.queries.filter((q) => q.pathname.endsWith("arrow"))).toHaveLength(
      4,
    );
    f.setStatus(403);
    await expect(
      f.runtime.runPromise(
        selectBars(client, { ...key, time: { from: 0, to: 30000000 } }),
      ),
    ).rejects.toMatchObject({ reason: { _tag: "Dataset.AccessDenied" } });
  } finally {
    await f.close();
  }
});
test("wide history windows intersect OpenChart's epoch without losing available bars", async () => {
  const rows = [bar(0), bar(1000)];
  const f = await fixture(rows);
  try {
    const client = await f.runtime.runPromise(OpenChartClient);
    const key = {
      listing: listing.id,
      session: "regular" as const,
      resolution: "1W" as const,
      adjustment: "split" as const,
    };
    const crossing = await f.runtime.runPromise(
      selectBars(client, { ...key, time: { from: -100000, to: 2000 } }),
    );
    expect([...crossing]).toEqual(rows);
    for (const time of [
      { from: -100000, to: -1 },
      { from: -100000, to: 0 },
      { to: -1 },
    ]) {
      const frame = await f.runtime.runPromise(
        selectBars(client, { ...key, time, count: 100 }),
      );
      expect(frame.numRows).toBe(0);
    }
    const requests = f.queries.filter((q) => q.pathname.endsWith("arrow"));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.searchParams.get("start")).toBe("0");
  } finally {
    await f.close();
  }
});
test("OpenChart is unavailable until admission succeeds, then explicit refresh recovers", async () => {
  const f = await fixture([]);
  try {
    const beforePublicChecks = f.queries.length;
    for (const providerId of ["binance", "yfinance"] as const)
      expect(await f.caller.providers.checkAccess({ providerId })).toEqual({
        status: "granted",
      });
    expect(f.queries).toHaveLength(beforePublicChecks);
    const client = await f.runtime.runPromise(OpenChartClient);
    const available = async () => {
      const services = await f.runtime.runPromise(f.feed.get());
      const status = await f.runtime.runPromise(
        services.symbology.indexStatus(),
      );
      return status.find((s) => s.providerId === "openchart")?.available;
    };
    f.setStatus(403);
    await f.runtime.runPromise(client.reset());
    await vi.waitFor(async () => expect(await available()).toBe(false));
    expect(
      await f.caller.providers.checkAccess({ providerId: "openchart" }),
    ).toEqual({ status: "required", action: "subscribe" });
    const requests = f.queries.length;
    await new Promise((resolve) => setTimeout(resolve, 5_200));
    expect(f.queries).toHaveLength(requests);
    f.setStatus(200);
    await f.caller.providers.refresh();
    await vi.waitFor(async () => expect(await available()).toBe(true), {
      timeout: 10000,
    });
  } finally {
    await f.close();
  }
}, 15000);
test("Feed keeps OpenChart search identity, filters classes and exposes unified history/live capabilities", async () => {
  const f = await fixture([]);
  try {
    const services = await f.runtime.runPromise(f.feed.get());
    const hits = await f.runtime.runPromise(
      services.symbology.search({
        query: "BTC",
        limit: 10,
        indexed: false,
        assetClass: "crypto",
      }),
    );
    expect(hits).toEqual([{ provider: "openchart", listing }]);
    const status = await f.runtime.runPromise(services.symbology.indexStatus());
    expect(status.map((s) => s.providerId).sort()).toEqual([
      "binance",
      "openchart",
      "yfinance",
    ]);
    const caps = await f.runtime.runPromise(
      services.bars.getCapabilities(series),
    );
    expect(caps).toHaveLength(
      OpenChartResolution.literals.length *
        OpenChartAdjustment.literals.length *
        3,
    );
    // The first combination per resolution is the chart default.
    expect(caps.find((c) => c.resolution === "1d")).toMatchObject({
      session: "regular",
      adjustment: "split",
    });
    expect(
      caps.every(
        (capability) =>
          capability.modes.includes("history") &&
          capability.modes.includes("live"),
      ),
    ).toBe(true);
    await f.caller.access.auth.logout();
    await vi.waitFor(async () => {
      const current = await f.runtime.runPromise(f.feed.get());
      expect(
        await f.runtime.runPromise(current.bars.getCapabilities(series)),
      ).toEqual([]);
    });
  } finally {
    await f.close();
  }
});
test("history handoff retains initial live bar even with an older asOf; stale updates cannot regress it", async () => {
  const t = Date.now() - 60000;
  const f = await fixture(
    [bar(t, 100, false, t + 100)],
    bar(t, 110, false, t + 1),
  );
  try {
    const services = await f.runtime.runPromise(f.feed.get());
    await f.runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const observed = yield* services.bars.observe(
            Schema.decodeUnknownSync(BarsRequest)({
              ...series,
              from: t,
              to: "now",
              countBack: 1,
            }),
          );
          expect(observed.snapshot.data.get(0)?.close).toBe(100);
          const updates: number[] = [];
          const running = yield* observed.updates!.pipe(
            Stream.tap((frame) =>
              Effect.sync(() => {
                updates.push(frame.get(0)!.close!);
              }),
            ),
            Stream.runDrain,
            Effect.forkScoped,
          );
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(updates).toEqual([110])),
          );
          f.send(bar(t, 105, false, t));
          f.send(bar(t, 120, true, t + 2));
          f.send(bar(t, 130, false, t + 3));
          f.send(bar(t, 999, true, t + 4));
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(updates).toEqual([110, 120])),
          );
          yield* Fiber.interrupt(running);
        }),
      ),
    );
  } finally {
    await f.close();
  }
});
test("an open history tail still keeps buffered live from revising earlier finalized bars", async () => {
  const t = Date.now() - 60000;
  const f = await fixture(
    [bar(t - 60000, 90, true, t), bar(t, 100, false, t + 100)],
    bar(t - 60000, 80, false, t - 1),
  );
  try {
    const services = await f.runtime.runPromise(f.feed.get());
    await f.runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const observed = yield* services.bars.observe(
            Schema.decodeUnknownSync(BarsRequest)({
              ...series,
              from: t - 60000,
              to: "now",
              countBack: 1,
            }),
          );
          expect([...observed.snapshot.data].map((row) => row.close)).toEqual([
            90, 100,
          ]);
          const updates: number[] = [];
          const running = yield* observed.updates!.pipe(
            Stream.tap((frame) =>
              Effect.sync(() => {
                for (const row of frame) updates.push(row.close!);
              }),
            ),
            Stream.runDrain,
            Effect.forkScoped,
          );
          f.send(bar(t, 110, false, t + 200));
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(updates).toEqual([110])),
          );
          yield* Fiber.interrupt(running);
        }),
      ),
    );
  } finally {
    await f.close();
  }
});
test("a bucket closing during history acquisition cannot revise committed Tea input", async () => {
  const t = Math.floor(Date.now() / 60000) * 60000 - 60000;
  const f = await fixture(
    [bar(t, 100, true, t + 60000)],
    bar(t, 120, false, t + 1),
  );
  try {
    const pending = f.runtime.runPromise(
      new TeaAlerts({
        source:
          'alertcondition("hit", close > 110, "Hit", "OpenChart price crossed")',
        config: { ...Tea.barsInputs(series), parameters: {}, requests: {} },
        warmupBars: 1,
      })
        .observe()
        .pipe(
          Stream.flattenIterable,
          Stream.take(1),
          Stream.runCollect,
          Effect.scoped,
          Effect.timeout("5 seconds"),
        ),
    );
    await vi.waitFor(() =>
      expect(f.queries.some((q) => q.pathname.endsWith("arrow"))).toBe(true),
    );
    f.send(bar(t, 100, true, t + 60000));
    f.send(bar(t + 60000, 130, false, t + 60001));
    const [event] = await pending;
    expect(event!.time).toBe(t + 60000);
    expect(event!.data.inputs).toEqual(series);
  } finally {
    await f.close();
  }
});
test.each([1012, 1013])(
  "server renewal %i catches up closed bars and replaces its health check",
  async (code) => {
    const t = Math.floor(Date.now() / 60000) * 60000 - 180000;
    const rows = [bar(t - 60000, 90)];
    const f = await fixture(rows, bar(t, 100, false));
    try {
      const services = await f.runtime.runPromise(f.feed.get());
      const monitoring = await f.runtime.runPromise(Monitoring.Service);
      const status = monitoring.status.pipe(
        Effect.map((all) => all.find((item) => item.key === "alert/renewal")),
      );
      await f.runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const observed = yield* services.bars.observe(
              Schema.decodeUnknownSync(BarsRequest)({
                ...series,
                from: t - 60000,
                to: "now",
                countBack: 1,
              }),
            );
            const received: number[] = [];
            const running = yield* observed.updates!.pipe(
              Stream.tap((frame) =>
                Effect.sync(() => {
                  for (const row of frame) received.push(row.close!);
                }),
              ),
              Stream.runDrain,
              Effect.result,
              Effect.forkScoped,
            );
            yield* Effect.promise(() =>
              vi.waitFor(() => expect(received).toEqual([100])),
            );
            rows.push(
              bar(t, 120, true, t + 60000),
              bar(t + 60000, 130, true, t + 120000),
            );
            f.setInitial(bar(t + 120000, 140, false));
            for (const socket of f.ws.clients) socket.close(code);
            yield* Effect.promise(() =>
              vi.waitFor(() => expect(received).toEqual([100, 120, 130, 140])),
            );
            expect(yield* status).toMatchObject({
              health: { state: "healthy" },
              checks: [{ health: { state: "healthy" } }],
            });
            // A second renewal re-reads history but must not revise an already closed bar.
            rows[2] = bar(t + 60000, 999, true, t + 180000);
            rows.push(bar(t + 120000, 150, true, t + 180000));
            f.setInitial(bar(t + 180000, 160, false));
            for (const socket of f.ws.clients) socket.close(code);
            yield* Effect.promise(() =>
              vi.waitFor(
                () => expect(received).toEqual([100, 120, 130, 140, 150, 160]),
                { timeout: 5000 },
              ),
            );
            expect(f.ws.clients.size).toBe(1);
            expect(yield* status).toMatchObject({
              health: { state: "healthy" },
              checks: [{ health: { state: "healthy" } }],
            });
            // Admission failure is terminal, never hidden by the renewal loop.
            f.setStatus(403);
            for (const socket of f.ws.clients) socket.close(code);
            const outcome = yield* Fiber.join(running);
            expect(outcome).toMatchObject({
              _tag: "Failure",
              failure: {
                reason: { _tag: "Feed.AccessDenied", provider: "openchart" },
              },
            });
            expect(yield* status).toBeUndefined();
          }),
        ).pipe(
          Effect.provideService(
            Monitoring.Reporter,
            monitoring.reporter("alert/renewal", "Renewal test"),
          ),
        ),
      );
      await vi.waitFor(() => expect(f.ws.clients.size).toBe(0));
    } finally {
      await f.close();
    }
  },
);
test.each([1, 2])(
  "OpenChart WebSocket reaches Tea alert evaluation and releases the socket, run %i",
  async () => {
    const t = Math.floor(Date.now() / 60000) * 60000;
    const f = await fixture(
      [bar(t - 60000, 100), bar(t, 100, false)],
      bar(t, 100, false),
    );
    try {
      const alert = new TeaAlerts({
        source:
          'alertcondition("hit", close > 110, "Hit", "OpenChart price crossed")',
        config: { ...Tea.barsInputs(series), parameters: {}, requests: {} },
        warmupBars: 2,
      });
      const pending = f.runtime.runPromise(
        alert
          .observe()
          .pipe(
            Stream.flattenIterable,
            Stream.take(1),
            Stream.runCollect,
            Effect.scoped,
            Effect.timeout("5 seconds"),
          ),
      );
      await vi.waitFor(() => expect(f.ws.clients.size).toBe(1));
      // Wait until snapshot has been requested; the transport buffers these updates.
      await vi.waitFor(() =>
        expect(f.queries.some((q) => q.pathname.endsWith("arrow"))).toBe(true),
      );
      f.send(bar(t, 120, false, t + 2));
      const [event] = await pending;
      expect(event!.data.inputs).toEqual(series);
      expect(event!.time).toBe(t);
      await vi.waitFor(() => expect(f.ws.clients.size).toBe(0));
    } finally {
      await f.close();
    }
  },
);

test.each(OpenChartResolution.literals)(
  "%s uses the same price basis for history and live",
  async (resolution) => {
    const t = Date.now() - 60000;
    const f = await fixture(
      [bar(t - 60000, 100)],
      bar(t, 110, false),
      resolution,
    );
    try {
      const services = await f.runtime.runPromise(f.feed.get());
      for (const adjustment of OpenChartAdjustment.literals) {
        await f.runtime.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const observed = yield* services.bars.observe(
                Schema.decodeUnknownSync(BarsRequest)({
                  ...series,
                  resolution,
                  adjustment,
                  from: t - 60000,
                  to: "now",
                  countBack: 1,
                }),
              );
              expect(observed.snapshot.data.get(0)?.close).toBe(100);
              const frames = yield* observed.updates!.pipe(
                Stream.take(1),
                Stream.runCollect,
                Effect.timeout("5 seconds"),
              );
              expect(frames[0]?.get(0)?.close).toBe(110);
              const queries = f.queries.filter(
                (url) => url.searchParams.get("adjustment") === adjustment,
              );
              expect(
                queries.some(
                  (url) =>
                    url.pathname.endsWith("arrow") &&
                    url.searchParams.get("resolution") === resolution,
                ),
              ).toBe(true);
              expect(
                f.commands.some(
                  (command) =>
                    command.type === "subscribe" &&
                    command.series?.resolution === resolution &&
                    command.series?.adjustment === adjustment,
                ),
              ).toBe(true);
            }),
          ),
        );
      }
    } finally {
      await f.close();
    }
  },
  20000,
);
