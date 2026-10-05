// Purpose: Prove a bulk catalog crosses the real RPC/SSE boundary without per-row query churn.
import { once } from "node:events";
import { Effect, ConfigProvider, Stream } from "effect";
import { EventSource } from "eventsource";
import { expect, test, vi } from "vitest";
import { binanceSymbology } from "@openchart/server/data/providers/binance/datasets/definitions";
import { createServer } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { catalogLayer, makeDataset } from "@openchart/server/data";
import { createTransport } from "@openchart/app/lib/transport/transport";

test("indexes 1000 listings while a real SSE subscriber remains live; public writes are absent", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    symbol: `PAIR${i}USDT`,
    baseAsset: `PAIR${i}`,
    quoteAsset: "USDT",
    status: "TRADING",
  }));
  const server = await createServer({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
    datasets: catalogLayer(
      Effect.succeed([
        {
          definitions: [binanceSymbology],
          watch: () =>
            Stream.unwrap(
              makeDataset(binanceSymbology, {
                select: () => Effect.succeed(rows),
                search: () => Effect.succeed([]),
              }).pipe(
                Effect.map((dataset) =>
                  Stream.concat(Stream.succeed([dataset]), Stream.never),
                ),
                Effect.orDie,
              ),
            ),
        },
      ]),
    ),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const transport = createTransport(
    { origin: `http://127.0.0.1:${address.port}` },
    { EventSource },
  );
  const errors = vi.fn();
  let ready = false;
  let changes = 0;
  const subscription = transport.events.subscribe({
    next: (frame) => {
      if (frame.kind === "ready") ready = true;
      if (frame.kind === "event" && frame.event.type === "resource.changed")
        changes++;
    },
    error: errors,
  });
  try {
    await vi.waitFor(() => expect(ready).toBe(true));
    await vi.waitFor(async () =>
      expect(
        (await transport.rpc.feed.symbology.indexStatus.query())[0]?.available,
      ).toBe(true),
    );
    await transport.rpc.feed.symbology.index.mutate({
      providerId: "binance",
      filter: {},
    });
    // Allow CI headroom for the bulk SQLite commit and its SSE publication.
    await vi.waitFor(
      async () =>
        expect(
          (await transport.rpc.feed.symbology.indexStatus.query())[0]?.job,
        ).toMatchObject({ state: "succeeded" }),
      { timeout: 10_000 },
    );
    expect(await transport.rpc.resources.symbology.counts.query()).toEqual([
      { provider: "binance", count: 1000 },
    ]);
    await vi.waitFor(() => expect(changes).toBe(1000), { timeout: 10_000 });
    expect(errors).not.toHaveBeenCalled();
    expect(
      await transport.rpc.feed.symbology.search.query({
        query: "PAIR1",
        indexed: true,
        limit: 3,
      }),
    ).toHaveLength(3);
    const response = await fetch(
      `http://127.0.0.1:${address.port}/trpc/resources.symbology.create`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(404);
  } finally {
    subscription.unsubscribe();
    transport.hose.disconnect();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 30_000);
