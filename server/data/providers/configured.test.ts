// Purpose: Provider config changes cancel obsolete acquisition and revoke published Dataset handles.
import {
  Config,
  ConfigProvider,
  Deferred,
  Effect,
  Layer,
  ManagedRuntime,
  Stream,
  SubscriptionRef,
} from "effect";
import { expect, test, vi } from "vitest";
import { echo } from "@openchart/server/data/dataset/tests/fixtures";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import {
  Catalog,
  catalogLayer,
  makeDataset,
  type Dataset,
} from "@openchart/server/data";
import { ConfigProviderUpdates } from "@openchart/server/config/provider";
import { configuredDatasets, providerEnabled } from "./configured";

test.each([
  [{}, true],
  [{ providers: { binance: {} } }, true],
  [{ providers: { binance: { enabled: false } } }, false],
  [{ providers: { yfinance: { enabled: false } } }, true],
])("providerEnabled reads %j as %s", (settings, enabled) => {
  expect(
    Effect.runSync(
      providerEnabled("binance").parse(ConfigProvider.fromUnknown(settings)),
    ),
  ).toBe(enabled);
});

test("a Provider handles disabled, pending, ready and revoked states without exposing acquisition", async () => {
  const settings = Effect.runSync(
    SubscriptionRef.make(ConfigProvider.fromUnknown({})),
  );
  const source = ConfigProvider.make((path) =>
    Effect.flatMap(SubscriptionRef.get(settings), (current) =>
      current.load(path),
    ),
  );
  const started = Effect.runSync(Deferred.make<void>());
  let attempts = 0,
    closed = 0,
    interrupted = false;
  const acquire = Effect.gen(function* () {
    attempts++;
    if (attempts === 1)
      yield* Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          }),
        ),
      );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed++;
      }),
    );
    const dataset = yield* makeDataset(echo, {
      select: () => Effect.succeed([{ value: "ready" }]),
      search: () => Effect.succeed([]),
      stream: () => Effect.succeed(Stream.never),
    });
    return [dataset];
  });
  const retirements: Deferred.Deferred<void>[] = [];
  const provider = Effect.gen(function* () {
    const stream = yield* configuredDatasets(
      Config.boolean("enabled").pipe(Config.withDefault(false)),
      (retired) => {
        retirements.push(retired);
        return acquire;
      },
      () => Effect.succeed({ status: "granted" } as const),
    );
    return [{ definitions: [echo], watch: () => stream }];
  });
  const runtime = ManagedRuntime.make(
    catalogLayer(provider).pipe(
      Layer.provide(ConfigProvider.layer(source)),
      Layer.provide(
        Layer.succeed(ConfigProviderUpdates, (actual) =>
          actual === source ? SubscriptionRef.changes(settings) : Stream.empty,
        ),
      ),
    ),
  );
  const enabled = (value: unknown) =>
    runtime.runPromise(
      SubscriptionRef.set(
        settings,
        ConfigProvider.fromUnknown({ enabled: value }),
      ),
    );
  try {
    const catalog = await runtime.runPromise(Catalog);
    expect(await runtime.runPromise(catalog.list())).toEqual([]);
    await enabled(true);
    await runtime.runPromise(Deferred.await(started));
    await enabled(false);
    await vi.waitFor(() => expect(interrupted).toBe(true));
    expect(await runtime.runPromise(catalog.list())).toEqual([]);
    await enabled(true);
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(catalog.list())).toHaveLength(1),
    );
    const dataset = (await runtime.runPromise(catalog.list())).find(
      (ready) => ready.definition === echo,
    ) as Dataset<typeof echo>;
    expect(await runtime.runPromise(dataset.select({ topic: "x" }))).toEqual([
      { value: "ready" },
    ]);
    await enabled(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(attempts).toBe(2);
    await enabled("invalid");
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(catalog.list())).toEqual([]),
    );
    expect(closed).toBe(1);
    expect(
      retirements.every((retired) => Effect.runSync(Deferred.isDone(retired))),
    ).toBe(true);
    await expect(
      runtime.runPromise(dataset.select({ topic: "x" })),
    ).rejects.toMatchObject({
      dataset: "test.echo",
      operation: "select",
      reason: { _tag: "Dataset.Retired" },
    });
    await enabled(true);
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(catalog.list())).toHaveLength(1),
    );
  } finally {
    await runtime.dispose();
  }
  expect(closed).toBe(2);
});

test("failed construction releases its partial resources before waiting to retry", async () => {
  let opened = 0;
  let closed = 0;
  const acquire = Effect.gen(function* () {
    opened++;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed++;
      }),
    );
    return yield* Effect.fail(
      new DatasetFailure(new DatasetReasons.Unavailable()),
    );
  });
  const runtime = ManagedRuntime.make(
    catalogLayer(
      Effect.gen(function* () {
        const stream = yield* configuredDatasets(
          Config.boolean("enabled"),
          () => acquire,
          () => Effect.succeed({ status: "granted" } as const),
        );
        return [{ definitions: [echo], watch: () => stream }];
      }),
    ).pipe(
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ enabled: true })),
      ),
    ),
  );
  try {
    const catalog = await runtime.runPromise(Catalog);
    await vi.waitFor(() => expect([opened, closed]).toEqual([1, 1]));
    expect(await runtime.runPromise(catalog.list())).toEqual([]);
  } finally {
    await runtime.dispose();
  }
});

test("access requirements skip acquisition and permission errors wait for explicit reactivation", async () => {
  const access = vi.fn<
    () => Effect.Effect<
      import("@openchart/server/data/provider").ProviderAccess,
      DatasetFailure
    >
  >(() => Effect.succeed({ status: "required", action: "subscribe" }));
  const acquire = vi.fn(() => Effect.succeed([]));
  const settings = Effect.runSync(
    SubscriptionRef.make(ConfigProvider.fromUnknown({ enabled: true })),
  );
  const source = ConfigProvider.make((path) =>
    Effect.flatMap(SubscriptionRef.get(settings), (value) => value.load(path)),
  );
  const runtime = ManagedRuntime.make(
    catalogLayer(
      Effect.gen(function* () {
        const stream = yield* configuredDatasets(
          Config.boolean("enabled"),
          acquire,
          access,
        );
        return [{ definitions: [], watch: () => stream }];
      }),
    ).pipe(
      Layer.provide(ConfigProvider.layer(source)),
      Layer.provide(
        Layer.succeed(ConfigProviderUpdates, () =>
          SubscriptionRef.changes(settings),
        ),
      ),
    ),
  );
  const enable = (enabled: boolean) =>
    runtime.runPromise(
      SubscriptionRef.set(settings, ConfigProvider.fromUnknown({ enabled })),
    );
  try {
    await runtime.context();
    await vi.waitFor(() => expect(access).toHaveBeenCalledOnce());
    expect(acquire).not.toHaveBeenCalled();
    await enable(false);
    access.mockImplementation(() =>
      Effect.fail(new DatasetFailure(new DatasetReasons.AccessDenied())),
    );
    await enable(true);
    await vi.waitFor(() => expect(access).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 5_200));
    expect(access).toHaveBeenCalledTimes(2);
    expect(acquire).not.toHaveBeenCalled();
    await enable(false);
    access.mockImplementation(() => Effect.succeed({ status: "granted" }));
    await enable(true);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
  } finally {
    await runtime.dispose();
  }
}, 10_000);
