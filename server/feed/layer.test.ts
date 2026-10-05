// Purpose: Feed snapshots replace atomically while Providers and callers retain request ownership.
import {
  Deferred,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { expect, test, vi } from "vitest";
import {
  binanceBars,
  binanceSymbology,
} from "@openchart/server/data/providers/binance/datasets/definitions";
import { echo } from "@openchart/server/data/dataset/tests/fixtures";
import { BarsRequest } from "@openchart/feed";
import {
  Catalog,
  catalogLayer,
  makeDataset,
  type Dataset,
} from "@openchart/server/data";
import { Events } from "@openchart/server/events";
import * as symbology from "@openchart/server/feed/symbology/provisioner";
import { feedLayer } from "./layer";
import { Feed } from "./service";
import { Database } from "@openchart/server/db";

const request = Schema.decodeUnknownSync(BarsRequest)({
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "Binance",
    currency: "USDT",
  },
  resolution: "1m",
  adjustment: "raw",
  session: "24h",
  from: 0,
  to: "now",
  countBack: 1,
});

test("versions follow relevant datasets; existing work survives Provider retirement until its caller cancels", async () => {
  const owner = Scope.makeUnsafe();
  const requested = Effect.runSync(Deferred.make<void>());
  const searchStarted = Effect.runSync(Deferred.make<void>());
  const finishSearch = Effect.runSync(Deferred.make<void>());
  let cancelled = false;
  const bars = await Effect.runPromise(
    makeDataset(binanceBars, {
      select: () =>
        Deferred.succeed(requested, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              cancelled = true;
            }),
          ),
        ),
      stream: () => Effect.succeed(Stream.never),
    }).pipe(Scope.provide(owner)),
  );
  const symbols = await Effect.runPromise(
    makeDataset(binanceSymbology, {
      select: () => Effect.succeed([]),
      search: () =>
        Deferred.succeed(searchStarted, undefined).pipe(
          Effect.andThen(Deferred.await(finishSearch)),
          Effect.as([]),
        ),
    }).pipe(Scope.provide(owner)),
  );
  const unrelated = await Effect.runPromise(
    makeDataset(echo, {
      select: () => Effect.succeed([]),
      search: () => Effect.succeed([]),
      stream: () => Effect.succeed(Stream.never),
    }).pipe(Scope.provide(owner)),
  );
  const states = Effect.runSync(
    SubscriptionRef.make<readonly Dataset[]>([bars, symbols]),
  );
  const runtime = ManagedRuntime.make(
    feedLayer.pipe(
      Layer.provideMerge(
        catalogLayer(
          Effect.succeed([
            {
              definitions: [binanceBars, binanceSymbology, echo],
              watch: () => SubscriptionRef.changes(states),
            },
          ]),
        ),
      ),
      Layer.provideMerge(Events.layer),
      Layer.provide(Database.layer(":memory:", () => Effect.void)),
    ),
  );
  try {
    const feed = await runtime.runPromise(Feed);
    const catalog = await runtime.runPromise(Catalog);
    let version = await runtime.runPromise(feed.getVersion());
    await vi.waitFor(async () => {
      version = await runtime.runPromise(feed.getVersion());
      const services = await runtime.runPromise(feed.get());
      expect(
        await runtime.runPromise(services.bars.getCapabilities(request)),
      ).not.toEqual([]);
    });
    const original = await runtime.runPromise(feed.get());
    const search = runtime
      .runPromise(
        original.symbology.search({ query: "BTC", limit: 5, indexed: false }),
      )
      .catch((error) => error);
    await runtime.runPromise(Deferred.await(searchStarted));
    await runtime.runPromise(
      SubscriptionRef.set(states, [bars, symbols, unrelated]),
    );
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(catalog.list())).toHaveLength(3),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await runtime.runPromise(feed.getVersion())).toBe(version);
    const controller = new AbortController();
    const pending = runtime
      .runPromise(
        Effect.scoped(original.bars.observe({ ...request, to: 100 })),
        {
          signal: controller.signal,
        },
      )
      .catch((error) => error);
    await runtime.runPromise(Deferred.await(requested));
    await runtime.runPromise(SubscriptionRef.set(states, [symbols, unrelated]));
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(feed.getVersion())).not.toBe(version),
    );
    expect(cancelled).toBe(false);
    expect(await runtime.runPromise(feed.get())).not.toBe(original);
    await runtime.runPromise(Deferred.succeed(finishSearch, undefined));
    expect(await search).toEqual([]);
    expect(
      await runtime.runPromise(
        original.symbology.search({ query: "BTC", limit: 5, indexed: false }),
      ),
    ).toEqual([]);
    await runtime.runPromise(SubscriptionRef.set(states, [bars, symbols]));
    await vi.waitFor(async () => {
      const current = await runtime.runPromise(feed.get());
      expect(
        await runtime.runPromise(current.bars.getCapabilities(request)),
      ).not.toEqual([]);
    });
    await Effect.runPromise(Scope.close(owner, Exit.void));
    expect(cancelled).toBe(false);
    controller.abort();
    await pending;
    expect(cancelled).toBe(true);
    await expect(
      runtime.runPromise(
        original.symbology.search({ query: "BTC", limit: 5, indexed: false }),
      ),
    ).rejects.toMatchObject({
      reason: { _tag: "Feed.Reconfigured", provider: "binance" },
    });
  } finally {
    await runtime.dispose();
    await Effect.runPromise(Scope.close(owner, Exit.void));
  }
});

test("a provisioning defect retains the complete snapshot and the next Catalog update recovers", async () => {
  const owner = Scope.makeUnsafe();
  const dataset = await Effect.runPromise(
    makeDataset(binanceSymbology, {
      select: () => Effect.succeed([]),
      search: () => Effect.succeed([]),
    }).pipe(Scope.provide(owner)),
  );
  const states = Effect.runSync(
    SubscriptionRef.make<readonly Dataset[]>([dataset]),
  );
  const runtime = ManagedRuntime.make(
    feedLayer.pipe(
      Layer.provide(
        catalogLayer(
          Effect.succeed([
            {
              definitions: [binanceSymbology],
              watch: () => SubscriptionRef.changes(states),
            },
          ]),
        ),
      ),
      Layer.provideMerge(Events.layer),
      Layer.provide(Database.layer(":memory:", () => Effect.void)),
    ),
  );
  const provision = vi.spyOn(symbology, "provisionSymbology");
  try {
    const feed = await runtime.runPromise(Feed);
    await vi.waitFor(async () => {
      const services = await runtime.runPromise(feed.get());
      expect(
        await runtime.runPromise(
          services.symbology.search({ query: "BTC", limit: 5, indexed: false }),
        ),
      ).toEqual([]);
    });
    const version = await runtime.runPromise(feed.getVersion());
    const original = await runtime.runPromise(feed.get());
    const events = await runtime.runPromise(Events.Service);
    const publish = vi.spyOn(events, "publish");
    let failures = 0;
    provision.mockReturnValueOnce(
      Effect.sync(() => failures++).pipe(
        Effect.andThen(Effect.die(new Error("Failed provision"))),
      ),
    );
    const rejected = await Effect.runPromise(
      makeDataset(binanceSymbology, {
        select: () => Effect.succeed([]),
        search: () => Effect.succeed([]),
      }).pipe(Scope.provide(owner)),
    );
    await runtime.runPromise(SubscriptionRef.set(states, [rejected]));
    await vi.waitFor(() => expect(failures).toBe(1));
    expect(await runtime.runPromise(feed.getVersion())).toBe(version);
    expect(await runtime.runPromise(feed.get())).toBe(original);
    expect(
      await runtime.runPromise(
        original.symbology.search({ query: "BTC", limit: 5, indexed: false }),
      ),
    ).toEqual([]);
    expect(publish).not.toHaveBeenCalled();

    const replacement = await Effect.runPromise(
      makeDataset(binanceSymbology, {
        select: () => Effect.succeed([]),
        search: () => Effect.succeed([]),
      }).pipe(Scope.provide(owner)),
    );
    await runtime.runPromise(SubscriptionRef.set(states, [replacement]));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    const next = await runtime.runPromise(feed.getVersion());
    expect(next).not.toBe(version);
    expect(publish.mock.calls[0]?.[1]).toEqual({ version: next });
    const services = await runtime.runPromise(feed.get());
    expect(
      await runtime.runPromise(
        services.symbology.search({ query: "BTC", limit: 5, indexed: false }),
      ),
    ).toEqual([]);
  } finally {
    provision.mockRestore();
    await runtime.dispose();
    await Effect.runPromise(Scope.close(owner, Exit.void));
  }
});
