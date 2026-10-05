// Purpose: Retirement closes admission while request scopes retain accepted work.
import { Cause, Deferred, Effect, Scope, Exit, Fiber, Stream } from "effect";
import { echo } from "@openchart/server/data/dataset/tests/fixtures";
import { expect, test } from "vitest";
import {
  DatasetFailure,
  DatasetReasons,
  type DatasetReason,
} from "@openchart/server/data/dataset";
import { makeDataset, type ProviderFor } from "./dataset";

const methods: ProviderFor<typeof echo> = {
  select: (query) => Effect.succeed([{ value: query.topic }]),
  search: (query) => Effect.succeed([{ value: query.query }]),
  stream: () => Effect.succeed(Stream.never),
};

test("retirement lets accepted multi-step requests finish and release their own resources", async () => {
  const owner = Scope.makeUnsafe();
  const started = Effect.runSync(Deferred.make<void>());
  const proceed = Effect.runSync(Deferred.make<void>());
  let closed = false;
  const dataset = await Effect.runPromise(
    makeDataset(echo, {
      ...methods,
      select: () =>
        Effect.gen(function* () {
          const resource = yield* Effect.acquireRelease(
            Effect.succeed({ value: "captured credentials" }),
            () =>
              Effect.sync(() => {
                closed = true;
              }),
          );
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(proceed);
          expect(closed).toBe(false);
          return [resource];
        }),
    }).pipe(Scope.provide(owner)),
  );
  const pending = Effect.runPromise(dataset.select({ topic: "old" }));
  await Effect.runPromise(Deferred.await(started));
  await Effect.runPromise(Scope.close(owner, Exit.void));
  expect(closed).toBe(false);
  await expect(
    Effect.runPromise(dataset.search({ query: "late" })),
  ).rejects.toMatchObject({
    dataset: "test.echo",
    operation: "search",
    reason: { _tag: "Dataset.Retired" },
  });
  await Effect.runPromise(Deferred.succeed(proceed, undefined));
  expect(await pending).toEqual([{ value: "captured credentials" }]);
  expect(closed).toBe(true);
});

test("caller cancellation still interrupts accepted requests after retirement", async () => {
  const owner = Scope.makeUnsafe();
  const started = Effect.runSync(Deferred.make<void>());
  let cancelled = false;
  const dataset = await Effect.runPromise(
    makeDataset(echo, {
      ...methods,
      select: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              cancelled = true;
            }),
          ),
        ),
    }).pipe(Scope.provide(owner)),
  );
  const controller = new AbortController();
  const result = Effect.runPromise(dataset.select({ topic: "old" }), {
    signal: controller.signal,
  });
  const rejected = expect(result).rejects.toThrow();
  await Effect.runPromise(Deferred.await(started));
  await Effect.runPromise(Scope.close(owner, Exit.void));
  expect(cancelled).toBe(false);
  controller.abort();
  await rejected;
  expect(cancelled).toBe(true);
});

test("the caller scope closes resources and prevents a retained lazy poller from starting", async () => {
  const owner = Scope.makeUnsafe();
  const request = Scope.makeUnsafe();
  let closed = false;
  let polls = 0;
  try {
    const dataset = await Effect.runPromise(
      makeDataset(echo, {
        ...methods,
        stream: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                closed = true;
              }),
            );
            return Stream.fromEffect(
              Effect.sync(() => {
                polls++;
                return { value: "late" };
              }),
            );
          }),
      }).pipe(Effect.provideService(Scope.Scope, owner)),
    );
    const stream = await Effect.runPromise(
      dataset
        .stream({ topic: "x" })
        .pipe(Effect.provideService(Scope.Scope, request)),
    );
    await Effect.runPromise(Scope.close(request, Exit.void));
    expect(closed).toBe(true);
    await expect(
      Effect.runPromise(Stream.runDrain(stream)),
    ).rejects.toMatchObject({
      dataset: "test.echo",
      operation: "stream",
      reason: { _tag: "Dataset.Retired" },
    });
    expect(polls).toBe(0);
  } finally {
    await Effect.runPromise(Scope.close(owner, Exit.void));
  }
});

test.each(["complete", "fail", "interrupt", "take"] as const)(
  "stream %s releases only its subscription before the caller scope closes",
  async (ending) => {
    const closed: string[] = [];
    const failure = new DatasetFailure(new DatasetReasons.Unavailable(), {
      cause: "Disconnected",
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const dataset = yield* makeDataset(echo, {
          ...methods,
          stream: (query) =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  closed.push(query.topic);
                }),
              );
              return Stream.concat(
                Stream.succeed({ value: query.topic }),
                ending === "fail"
                  ? Stream.fail(failure)
                  : ending === "complete"
                    ? Stream.empty
                    : Stream.fromEffect(
                        Deferred.succeed(started, undefined).pipe(
                          Effect.andThen(Effect.never),
                        ),
                      ),
              );
            }),
        });
        const updates = yield* dataset.stream({ topic: "first" });
        yield* dataset.stream({ topic: "sibling" });
        expect(closed).toEqual([]);
        if (ending === "interrupt") {
          const running = yield* updates.pipe(
            Stream.runDrain,
            Effect.forkScoped,
          );
          yield* Deferred.await(started);
          yield* Fiber.interrupt(running);
        } else {
          const result = yield* (
            ending === "take" ? updates.pipe(Stream.take(1)) : updates
          ).pipe(Stream.runCollect, Effect.result);
          expect(result).toMatchObject(
            ending === "fail"
              ? {
                  _tag: "Failure",
                  failure: {
                    _tag: "DatasetError",
                    operation: "stream",
                    reason: failure.reason,
                    cause: "Disconnected",
                  },
                }
              : { _tag: "Success", success: [{ value: "first" }] },
          );
        }
        expect(closed).toEqual(["first"]);
        expect(
          yield* updates.pipe(Stream.runDrain, Effect.result),
        ).toMatchObject({
          _tag: "Failure",
          failure: {
            dataset: "test.echo",
            operation: "stream",
            reason: { _tag: "Dataset.Retired" },
          },
        });
      }).pipe(Effect.scoped),
    );
    expect(closed).toEqual(["first", "sibling"]);
  },
);

test.each(["fail", "interrupt"] as const)(
  "acquisition %s releases partial resources before the caller scope closes",
  async (ending) => {
    let closed = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const failure = new DatasetFailure(new DatasetReasons.Unavailable(), {
          cause: "Could not subscribe",
        });
        const dataset = yield* makeDataset(echo, {
          ...methods,
          stream: () =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  closed++;
                }),
              );
              yield* Deferred.succeed(started, undefined);
              return yield* ending === "fail"
                ? Effect.fail(failure)
                : Effect.never;
            }),
        });
        const running = yield* dataset
          .stream({ topic: "partial" })
          .pipe(Effect.result, Effect.forkScoped);
        yield* Deferred.await(started);
        if (ending === "interrupt") yield* Fiber.interrupt(running);
        else
          expect(yield* Fiber.join(running)).toMatchObject({
            _tag: "Failure",
            failure: {
              _tag: "DatasetError",
              operation: "stream",
              reason: failure.reason,
              cause: "Could not subscribe",
            },
          });
        expect(closed).toBe(1);
      }).pipe(Effect.scoped),
    );
    expect(closed).toBe(1);
  },
);

test("closing scope rejects new work even while an unrelated finalizer is pending", async () => {
  const scope = Scope.makeUnsafe();
  const dataset = await Effect.runPromise(
    makeDataset(echo, methods).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await Effect.runPromise(
    Scope.addFinalizer(
      scope,
      Effect.promise(() => {
        entered();
        return pending;
      }),
    ),
  );
  const closing = Effect.runPromise(Scope.close(scope, Exit.void));
  await started;
  try {
    await expect(
      Effect.runPromise(dataset.select({ topic: "too late" })),
    ).rejects.toMatchObject({
      dataset: "test.echo",
      operation: "select",
      reason: { _tag: "Dataset.Retired" },
    });
  } finally {
    release();
    await closing;
  }
});

test("locates Provider failures with the Dataset and operation", async () => {
  const failure = (reason: DatasetReason) =>
    new DatasetFailure(reason, { cause: "upstream" });
  const errors = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const dataset = yield* makeDataset(echo, {
          ...methods,
          select: () => Effect.fail(failure(new DatasetReasons.NotFound())),
          stream: (query) =>
            query.topic === "acquire"
              ? Effect.fail(failure(new DatasetReasons.Unavailable()))
              : Effect.succeed(
                  Stream.fail(
                    failure(
                      new DatasetReasons.StreamInterrupted({
                        kind: "disconnected",
                      }),
                    ),
                  ),
                ),
        });
        return yield* Effect.all([
          Effect.flip(dataset.select({ topic: "x" })),
          Effect.flip(dataset.stream({ topic: "acquire" })),
          Effect.flip(
            Effect.flatMap(
              dataset.stream({ topic: "element" }),
              Stream.runDrain,
            ),
          ),
        ]);
      }),
    ),
  );
  expect(errors).toMatchObject([
    {
      _tag: "DatasetError",
      dataset: "test.echo",
      operation: "select",
      reason: { _tag: "Dataset.NotFound" },
      cause: "upstream",
    },
    {
      dataset: "test.echo",
      operation: "stream",
      reason: { _tag: "Dataset.Unavailable" },
    },
    {
      dataset: "test.echo",
      operation: "stream",
      reason: { _tag: "Dataset.StreamInterrupted", kind: "disconnected" },
    },
  ]);
});

test("methods that do not match the declaration are a defect, not a failure", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      makeDataset(echo, { select: methods.select } as typeof methods),
    ),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(Cause.hasFails(exit.cause)).toBe(false);
  }
});
