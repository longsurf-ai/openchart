// Purpose: Application composition shares Events and applies Provider config changes through Catalog and Feed.
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Database } from "@openchart/server/db";
import { PluginRegistry } from "@openchart/server/agent/plugin/registry";
import {
  Config,
  ConfigProvider,
  Effect,
  Exit,
  Scope,
  SubscriptionRef,
} from "effect";
import { mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Feed } from "@openchart/server/feed/service";
import { FeedVersionChanged } from "@openchart/server/feed/events";
import { Events } from "@openchart/server/events";
import {
  Catalog,
  catalogLayer,
  makeDataset,
  type Dataset,
} from "@openchart/server/data";
import type { DatasetDefinition } from "@openchart/server/data/dataset";
import { binanceSymbology } from "@openchart/server/data/providers/binance/datasets/definitions";
import { logos } from "@openchart/server/data/providers/local";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import { sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { makeRuntime } from "./runtime";
import { router } from "./index";

test("installs the Chart Explain input owner for analyst prompts", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
    datasets: catalogLayer(Effect.succeed([])),
    models: { fetchEnabled: false, userAgent: "OpenChart/ChartExplainTest" },
  });
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const registry = yield* PluginRegistry.Service;
        const definitions = PluginRegistry.resolve(
          yield* registry.all(),
          "analyst",
        );
        expect(definitions.map((definition) => definition.id)).toContain(
          "chart-explain",
        );
        yield* PluginRegistry.requireInputs(
          definitions,
          [
            {
              type: "chart_explain",
              drawingId: "drw_selection",
              resolution: "5m",
              session: "extended",
              adjustment: "split",
            },
          ],
          "analyst",
        );
      }),
    );
  } finally {
    await runtime.dispose();
  }
});

test("Resource and committed Feed versions use one eagerly acquired Events subscription", async () => {
  const owner = Scope.makeUnsafe();
  const states = Effect.runSync(SubscriptionRef.make<readonly Dataset[]>([]));
  const dataset = await Effect.runPromise(
    makeDataset(binanceSymbology, {
      select: () => Effect.succeed([]),
      search: () => Effect.succeed([]),
    }).pipe(Scope.provide(owner)),
  );
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
    datasets: catalogLayer(
      Effect.succeed([
        {
          definitions: [binanceSymbology],
          watch: () => SubscriptionRef.changes(states),
        },
      ]),
    ),
  });
  const caller = router.createCaller({ runtime });
  const iterator = (await caller.events.subscribe())[Symbol.asyncIterator]();
  try {
    expect((await iterator.next()).value).toEqual({ kind: "ready" });
    const before = await caller.feed.version();
    const dashboard = await caller.resources.dashboard.create({
      name: "Shared events",
    });
    await runtime.runPromise(SubscriptionRef.set(states, [dataset]));
    expect((await iterator.next()).value).toMatchObject({
      kind: "event",
      event: {
        type: ResourceChanged.type,
        data: { resource: "dashboard", id: dashboard.id },
      },
    });
    const feed = (await iterator.next()).value;
    const current = await caller.feed.version();
    expect(feed).toMatchObject({
      kind: "event",
      event: { type: FeedVersionChanged.type, data: { version: current } },
    });
    expect(current).not.toBe(before);
  } finally {
    await iterator.return?.();
    await runtime.dispose();
    await Effect.runPromise(Scope.close(owner, Exit.void));
  }
});

test("Provider-owned settings disable and restore datasets without rebuilding the runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openchart-runtime-"));
  const filename = join(directory, "settings.json");
  const settings = (enabled: unknown) =>
    JSON.stringify({
      probe: "same runtime",
      providers: { binance: { enabled }, yfinance: { enabled: false } },
    });
  await writeFile(filename, settings(false));
  const runtime = makeRuntime({
    home: directory,
  });
  try {
    const feed = await runtime.runPromise(Feed);
    const catalog = await runtime.runPromise(Catalog);
    await vi.waitFor(async () => {
      const services = await runtime.runPromise(feed.get());
      expect(
        await runtime.runPromise(services.logos.getLogo({ identifier: "BTC" })),
      ).toMatchObject({ id: "crypto:btc" });
    });
    const ready = async <D extends DatasetDefinition>(definition: D) =>
      (await runtime.runPromise(catalog.list())).find(
        (dataset) => dataset.definition === definition,
      ) as Dataset<D>;
    const bundledLogos = await ready(logos);
    const before = await runtime.runPromise(feed.getVersion());
    expect(await runtime.runPromise(catalog.list())).toEqual([bundledLogos]);
    const staging = join(directory, "replacement.json");
    await writeFile(staging, settings(true));
    await rename(staging, filename);
    await vi.waitFor(async () => {
      expect(await runtime.runPromise(catalog.list())).toHaveLength(3);
      expect(await runtime.runPromise(feed.getVersion())).not.toBe(before);
    });
    const active = await ready(binanceSymbology);
    const previous = await runtime.runPromise(feed.getVersion());
    await writeFile(filename, settings("invalid"));
    await vi.waitFor(async () => {
      expect(await runtime.runPromise(catalog.list())).toEqual([bundledLogos]);
      expect(await runtime.runPromise(feed.getVersion())).not.toBe(previous);
    });
    await expect(
      runtime.runPromise(active.search({ query: "BTC" })),
    ).rejects.toMatchObject({
      dataset: binanceSymbology.name,
      operation: "search",
      reason: { _tag: "Dataset.Retired" },
    });
    await writeFile(filename, settings(true));
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(catalog.list())).toHaveLength(3),
    );
    expect(await ready(binanceSymbology)).not.toBe(active);
    expect(await runtime.runPromise(Config.string("probe"))).toBe(
      "same runtime",
    );
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true });
  }
});

test("publishes a committed cascade batch through the shared Events service", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  try {
    const caller = router.createCaller({ runtime });
    const dashboard = await caller.resources.dashboard.create({
      name: "Example",
    });
    const { db } = await runtime.runPromise(Database.Service);
    await runtime.runPromise(
      db.transaction((tx) =>
        tx.run(sql`
      INSERT INTO chart (id, dashboard_id, revision)
      VALUES ('cht_one', ${dashboard.id}, 3), ('cht_two', ${dashboard.id}, 5)
    `),
      ),
    );
    const events = await runtime.runPromise(Events.Service);
    const publish = vi.spyOn(events, "publish");

    await caller.resources.dashboard.delete({ id: dashboard.id });

    expect(
      publish.mock.calls.map(([definition, data]) => {
        expect(definition).toBe(ResourceChanged);
        return data;
      }),
    ).toEqual([
      { resource: "chart", id: "cht_one", revision: 3 },
      { resource: "chart", id: "cht_two", revision: 5 },
      { resource: "dashboard", id: dashboard.id, revision: 1 },
    ]);
  } finally {
    vi.restoreAllMocks();
    await runtime.dispose();
  }
});
