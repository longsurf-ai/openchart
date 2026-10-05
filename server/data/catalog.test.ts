// Purpose: Catalog owns ready-set aggregation, identity checks and provider-watch subscriptions.
import {
  Cause,
  Effect,
  Exit,
  ManagedRuntime,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { echo, bars } from "@openchart/server/data/dataset/tests/fixtures";
import { expect, test, vi } from "vitest";
import {
  makeDataset,
  type Dataset,
} from "@openchart/server/data/dataset/index";
import { Catalog, catalogLayer } from "./catalog";

const methods = {
  select: () => Effect.succeed([]),
  search: () => Effect.succeed([]),
  stream: () => Effect.succeed(Stream.never),
};

test("publishes ready instances and withdraws only the changing provider", async () => {
  const owner = Scope.makeUnsafe();
  const dataset = await Effect.runPromise(
    makeDataset(echo, methods).pipe(Scope.provide(owner)),
  );
  const states = Effect.runSync(SubscriptionRef.make<readonly Dataset[]>([]));
  const runtime = ManagedRuntime.make(
    catalogLayer(
      Effect.succeed([
        { definitions: [echo], watch: () => SubscriptionRef.changes(states) },
      ]),
    ),
  );
  try {
    const catalog = await runtime.runPromise(Catalog);
    expect(await runtime.runPromise(catalog.list())).toEqual([]);
    await runtime.runPromise(SubscriptionRef.set(states, [dataset]));
    await vi.waitFor(async () =>
      expect(
        (await runtime.runPromise(catalog.list())).find(
          (ready) => ready.definition === echo,
        ),
      ).toBe(dataset),
    );
    const snapshot = await runtime.runPromise(catalog.list());
    await runtime.runPromise(SubscriptionRef.set(states, [dataset]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await runtime.runPromise(catalog.list())).toBe(snapshot);
    await runtime.runPromise(SubscriptionRef.set(states, []));
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(catalog.list())).toEqual([]),
    );
  } finally {
    await runtime.dispose();
    await Effect.runPromise(Scope.close(owner, Exit.void));
  }
});

test.each(["duplicate", "undeclared"] as const)(
  "dies instead of committing an invalid %s contribution",
  async (kind) => {
    const owner = Scope.makeUnsafe();
    const dataset = await Effect.runPromise(
      makeDataset(echo, methods).pipe(Scope.provide(owner)),
    );
    const runtime = ManagedRuntime.make(
      catalogLayer(
        Effect.succeed([
          {
            definitions: kind === "undeclared" ? [bars] : [echo],
            watch: () =>
              Stream.concat(
                Stream.succeed(
                  kind === "duplicate" ? [dataset, dataset] : [dataset],
                ),
                Stream.never,
              ),
          },
        ]),
      ),
    );
    try {
      const catalog = await runtime.runPromise(Catalog);
      await vi.waitFor(async () => {
        const exit = await runtime.runPromiseExit(catalog.list());
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      });
    } finally {
      await runtime.dispose();
      await Effect.runPromise(Scope.close(owner, Exit.void));
    }
  },
);

test("a failed watcher removes its contribution while another provider remains available", async () => {
  const stop = Effect.runSync(SubscriptionRef.make(false));
  const owner = Scope.makeUnsafe();
  const first = await Effect.runPromise(
    makeDataset(echo, methods).pipe(Scope.provide(owner)),
  );
  const second = await Effect.runPromise(
    makeDataset(bars, {
      select: () => Effect.die("unused"),
      stream: () => Effect.succeed(Stream.never),
    }).pipe(Scope.provide(owner)),
  );
  let closed = false;
  const runtime = ManagedRuntime.make(
    catalogLayer(
      Effect.succeed([
        {
          definitions: [echo],
          watch: () =>
            SubscriptionRef.changes(stop).pipe(
              Stream.mapEffect((done) =>
                done ? Effect.die("watch failed") : Effect.succeed([first]),
              ),
            ),
        },
        {
          definitions: [bars],
          watch: () =>
            Stream.concat(Stream.succeed([second]), Stream.never).pipe(
              Stream.ensuring(
                Effect.sync(() => {
                  closed = true;
                }),
              ),
            ),
        },
      ]),
    ),
  );
  try {
    const catalog = await runtime.runPromise(Catalog);
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(catalog.list())).toHaveLength(2),
    );
    await runtime.runPromise(SubscriptionRef.set(stop, true));
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(catalog.list())).toEqual([second]),
    );
  } finally {
    await runtime.dispose();
    await Effect.runPromise(Scope.close(owner, Exit.void));
  }
  expect(closed).toBe(true);
});
