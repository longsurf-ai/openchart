// Purpose: Prove the compiled-node lifecycle across real RPC, Hose and the browser client.
import { once } from "node:events";
import { Cause, ConfigProvider, Effect, Queue, Schema, Stream } from "effect";
import { lastValueFrom, toArray } from "rxjs";
import { expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { binanceBars } from "@openchart/server/data/providers/binance/datasets/definitions";
import { DatasetFailure } from "@openchart/server/data/dataset";
import { BarsSeries } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import { createServer } from "@openchart/server";
import {
  catalogLayer,
  makeDataset,
  type IDatasetProvider,
} from "@openchart/server/data";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { createTeaClient } from "@openchart/app/tea";
import { createTransport } from "@openchart/app/lib/transport/transport";

it("compiles once, streams attempts, evaluates another window and disposes explicitly and on client shutdown", async () => {
  vi.stubGlobal("WebSocket", WebSocket);
  const history = new Map([
    [0, { time: 0, close: 1, final: true }],
    [60_000, { time: 60_000, close: 2, final: true }],
    [120_000, { time: 120_000, close: 3, final: false }],
  ]);
  let revision = 1;
  const frame = (
    rows: readonly { time: number; close: number; final: boolean }[],
  ) =>
    binanceBars.frame.create({
      labels: {},
      rows: rows.map((row) => ({
        ...row,
        open: row.close,
        high: row.close,
        low: row.close,
        volume: revision,
        trades: revision,
        asOf: revision,
      })),
    });
  const queues = new Set<
    Queue.Queue<ReturnType<typeof frame>, DatasetFailure | Cause.Done>
  >();
  let closed = 0;
  const provider: IDatasetProvider = {
    definitions: [binanceBars],
    watch: () =>
      Stream.unwrap(
        Effect.gen(function* () {
          const dataset = yield* makeDataset(binanceBars, {
            select: (query) =>
              Effect.sync(() => {
                const rows = [...history.values()].filter(
                  (row) =>
                    (query.time.from === undefined ||
                      row.time >= query.time.from) &&
                    (query.time.to === undefined || row.time < query.time.to),
                );
                return frame(
                  query.count === undefined ? rows : rows.slice(-query.count),
                );
              }),
            stream: () =>
              Effect.gen(function* () {
                const queue = yield* Queue.unbounded<
                  ReturnType<typeof frame>,
                  DatasetFailure | Cause.Done
                >();
                queues.add(queue);
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    queues.delete(queue);
                    closed++;
                  }),
                );
                return Stream.fromQueue(queue);
              }),
          });
          return Stream.concat(Stream.succeed([dataset]), Stream.never);
        }).pipe(Effect.orDie),
      ),
  };
  const server = await createServer({
    home: temporaryHome(),
    databasePath: ":memory:",
    models: { fetchEnabled: false, userAgent: "tea-transport-test" },
    config: ConfigProvider.fromUnknown({}),
    datasets: catalogLayer(Effect.succeed([provider])),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server address");
  const transport = createTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  const tea = createTeaClient(transport);
  try {
    const workspaceId =
      await transport.rpc.resources.workspace.getDefault.query();
    const entry = await transport.rpc.workspace.write.mutate({
      workspaceId,
      path: "total.tea",
      text: 'factor = input.float(1)\nvar float total = 0.0\ntotal += close * factor\nemit "total" total',
      expected: null,
    });
    const node = await tea.compile({ workspaceId, path: entry.path });
    expect(node.definition.parameters[0]?.name).toBe("factor");
    expect(node.definition.inputs.fields.map((field) => field.name)).toEqual([
      "close",
    ]);
    await transport.rpc.workspace.remove.mutate({
      workspaceId,
      path: entry.path,
      expected: entry.hash,
    });
    const series = Schema.decodeUnknownSync(BarsSeries)({
      provider: "binance",
      listing: {
        symbol: "BTCUSDT",
        name: "Bitcoin",
        class: "crypto",
        venue: "BINANCE",
        currency: "USDT",
      },
      resolution: "1m",
      session: "24h",
      adjustment: "raw",
    });
    const request: Tea.ObserveRequest = {
      id: node.id,
      ...Tea.barsInputs(series),
      parameters: { factor: 1 },
      requests: {},
      nodes: {},
      from: 120_000,
      to: "now",
      countBack: 1,
      warmupBars: Tea.standardWarmupBars,
    };
    const messages: Tea.Message[] = [];
    let error: unknown;
    const live = tea.observe(request).subscribe({
      next: (message) => messages.push(message),
      error: (cause) => {
        error = cause;
      },
    });
    try {
      await vi.waitFor(() => expect(messages.length).toBe(1));
      const initial = messages[0]!;
      if (initial.type !== "snapshot")
        throw new Error("Expected snapshot first");
      expect(initial.rid).toEqual(expect.any(String));
      expect(
        [...initial.snapshot.data].map(({ total, provisional }) => ({
          total,
          provisional,
        })),
      ).toEqual([{ total: 6, provisional: true }]);
      const update = (time: number, close: number, final: boolean) => {
        revision++;
        const row = { time, close, final };
        history.set(time, row);
        for (const queue of queues) Queue.offerUnsafe(queue, frame([row]));
      };
      update(120_000, 4, false);
      await vi.waitFor(() => expect(messages.length).toBe(2));
      update(120_000, 5, true);
      await vi.waitFor(() => expect(messages.length).toBe(3));
      const attempts = messages
        .slice(1)
        .flatMap((message) =>
          message.type === "updates" ? [...message.data] : [],
        );
      expect(
        attempts.map(({ index, total, provisional }) => ({
          index,
          total,
          provisional,
        })),
      ).toEqual([
        { index: 2, total: 7, provisional: true },
        { index: 2, total: 8, provisional: false },
      ]);
      const wider = {
        ...request,
        parameters: { factor: 2 },
        from: 0,
        to: 180_000,
      };
      const finite = await lastValueFrom(tea.observe(wider).pipe(toArray()));
      expect(finite).toHaveLength(1);
      if (finite[0]?.type !== "snapshot")
        throw new Error("Expected finite snapshot");
      expect([...finite[0].snapshot.data].map((row) => row.total)).toEqual([
        2, 6, 16,
      ]);
      update(180_000, 6, false);
      await vi.waitFor(() => expect(messages.length).toBe(4));
      const latest = messages[3]!;
      if (latest.type !== "updates") throw new Error("Expected update");
      expect(latest.data.get(0)?.total).toBe(14);
      expect(error).toBeUndefined();
    } finally {
      live.unsubscribe();
    }
    await vi.waitFor(() => expect(closed).toBe(1));
    expect(queues.size).toBe(0);
    const reused = await lastValueFrom(
      tea.observe({ ...request, to: 180_000 }).pipe(toArray()),
    );
    expect(reused).toHaveLength(1);
    await tea.dispose({ id: node.id });
    await tea.dispose({ id: node.id });
    await expect(
      lastValueFrom(tea.observe({ ...request, to: 180_000 })),
    ).rejects.toMatchObject({ code: "node_unavailable" });
    await transport.rpc.workspace.write.mutate({
      workspaceId,
      path: entry.path,
      expected: null,
      text: 'factor = input.float(1)\nemit "total" close * factor',
    });
    const shutdownNode = await tea.compile({ workspaceId, path: entry.path });
    await tea.close();
    // A separate open client must see that the server ID was actually released.
    const verifier = createTeaClient(transport);
    try {
      await expect(
        lastValueFrom(
          verifier.observe({ ...request, id: shutdownNode.id, to: 180_000 }),
        ),
      ).rejects.toMatchObject({ code: "node_unavailable" });
    } finally {
      await verifier.close();
    }
  } finally {
    await tea.close();
    await server.shutdown();
    vi.unstubAllGlobals();
  }
}, 20_000);

it("snapshots a script with its imports, compiles an Indicator's stored snapshot after its Workspace files are deleted, and rejects a snapshot without its entry", async () => {
  vi.stubGlobal("WebSocket", WebSocket);
  const server = await createServer({
    home: temporaryHome(),
    databasePath: ":memory:",
    models: { fetchEnabled: false, userAgent: "tea-transport-test" },
    config: ConfigProvider.fromUnknown({}),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server address");
  const transport = createTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  const tea = createTeaClient(transport);
  try {
    const rpc = transport.rpc;
    const workspaceId = await rpc.resources.workspace.getDefault.query();
    const script =
      'import ./lib/scale\nfactor = input.float(2)\nemit "value" scale.by(close, factor)\n';
    const library = 'library("scale")\nexport by(x, k) => x * k\n';
    const entries = [
      await rpc.workspace.write.mutate({
        workspaceId,
        path: "study.tea",
        text: script,
        expected: null,
      }),
      await rpc.workspace.write.mutate({
        workspaceId,
        path: "lib/scale.tea",
        text: library,
        expected: null,
      }),
    ];
    const source = { workspaceId, path: "study.tea" };
    const fromPath = await tea.compile(source);
    const dashboard = await rpc.resources.dashboard.create.mutate({
      name: "Tea",
    });
    const chart = await rpc.resources.chart.create.mutate({
      dashboardId: dashboard.id,
    });
    const indicator = await rpc.resources.indicator.create.mutate({
      chartId: chart.id,
      cellId: "ccl_study",
      source,
      snapshot: { "study.tea": script, "lib/scale.tea": library },
      parameterOverrides: {},
    });
    expect(await tea.snapshot(source)).toEqual({
      entry: "study.tea",
      sources: indicator.snapshot,
    });
    for (const { path, hash } of entries)
      await rpc.workspace.remove.mutate({ workspaceId, path, expected: hash });
    await expect(tea.compile(source)).rejects.toMatchObject({
      code: "compile_failed",
    });
    await expect(tea.snapshot(source)).rejects.toMatchObject({
      code: "compile_failed",
    });

    const fromSnapshot = await tea.compile({
      entry: indicator.source.path,
      sources: indicator.snapshot,
    });
    expect(fromSnapshot.id).not.toBe(fromPath.id);
    expect(fromSnapshot.definition.parameters[0]?.name).toBe("factor");
    expect({
      ...Schema.encodeSync(Tea.CompileResponse)(fromSnapshot),
      id: "",
    }).toEqual({
      ...Schema.encodeSync(Tea.CompileResponse)(fromPath),
      id: "",
    });
    // The boundary rejects missing entries and mixed source forms.
    for (const invalid of [
      { entry: "other.tea", sources: indicator.snapshot },
      { ...source, entry: "study.tea", sources: indicator.snapshot },
    ])
      await expect(rpc.tea.compile.mutate(invalid)).rejects.toMatchObject({
        data: { code: "BAD_REQUEST" },
      });
  } finally {
    await tea.close();
    await server.shutdown();
    vi.unstubAllGlobals();
  }
});
