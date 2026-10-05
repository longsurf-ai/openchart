// Purpose: Locks resolve ordering, lazy Resource transitions, and atomic composition at the runner boundary.

import { Database } from "@openchart/server/db";
import { dashboardResource } from "@openchart/server/resources/dashboard";
import { agentScheduleResource } from "@openchart/server/resources/agent-schedule";
import { Deferred, Effect, Exit, Fiber, ManagedRuntime, Schema } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { STRICT_PARSE_OPTIONS } from "./definition";
import { RevisionConflict } from "./errors";
import * as Transition from "./transition";
import { run } from "./transactor";

let runtime: ManagedRuntime.ManagedRuntime<Database.Service, never>;
let db: Database.Client;
let onCommitted: ReturnType<typeof vi.fn<Database.OnCommitted>>;

beforeEach(async () => {
  onCommitted = vi.fn<Database.OnCommitted>(() => Effect.void);
  runtime = ManagedRuntime.make(Database.layer(":memory:", onCommitted));
  db = (await runtime.runPromise(Database.Service)).db;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

function dashboard(name: string) {
  return dashboardResource.transitions.create(
    Schema.decodeUnknownSync(
      dashboardResource.createSchema,
      STRICT_PARSE_OPTIONS,
    )({ name }),
  );
}

function schedule(name: string) {
  return agentScheduleResource.transitions.create(
    Schema.decodeUnknownSync(
      agentScheduleResource.createSchema,
      STRICT_PARSE_OPTIONS,
    )({
      name,
      enabled: false,
      target: {
        kind: "agent_prompt",
        prompt: {
          agent: "analyst",
          model: { providerID: "codex", modelID: "tier1" },
          parts: [{ type: "text", text: "Research" }],
        },
      },
      recurrence: { kind: "once", fireAt: "2090-01-01T00:00:00.000Z" },
    }),
  );
}

async function expectNoResources() {
  expect(
    await runtime.runPromise(run(dashboardResource.transitions.list())),
  ).toEqual({ items: [], nextCursor: null });
  expect(
    await runtime.runPromise(run(agentScheduleResource.transitions.list())),
  ).toEqual({ items: [], nextCursor: null });
  expect(onCommitted).not.toHaveBeenCalled();
}

test("constructs intrinsic transitions without IO or ids and creates a fresh id per execution", async () => {
  const createId = vi.spyOn(dashboardResource.id, "create");
  const insert = vi.spyOn(dashboardResource.store, "insert");
  const transaction = vi.spyOn(db, "transaction");
  const create = dashboard("Deferred");
  const id = dashboardResource.id.make("dsh_missing");
  dashboardResource.transitions.get(id);
  dashboardResource.transitions.list();
  dashboardResource.transitions.patch({
    id,
    expectedRevision: 1,
    operations: [{ op: "replace", path: "/name", value: "Deferred" }],
  });
  dashboardResource.transitions.remove(id);
  const program = run(create);

  expect(createId).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();

  const first = await runtime.runPromise(program);
  const second = await runtime.runPromise(program);
  expect(first.id).not.toBe(second.id);
  expect(first.revision).toBe(1);
  expect(second.revision).toBe(1);
  expect(createId).toHaveBeenCalledTimes(2);
  expect(transaction).toHaveBeenCalledTimes(2);
});

test("finishes resolution before acquiring a transaction and passes its result to apply", async () => {
  const transaction = vi.spyOn(db, "transaction");
  const created = await runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const transition = Transition.make({
          resolve: Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(finish);
            return { name: "Resolved" };
          }),
          apply: (tx, resolved) => dashboard(resolved.name).apply(tx),
        });
        const fiber = yield* run(transition).pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        expect(transaction).not.toHaveBeenCalled();
        // A pending resolver must not hold SQLite's transaction lock.
        yield* run(dashboard("While resolving"));
        yield* Deferred.succeed(finish, undefined);
        return yield* Fiber.join(fiber);
      }),
    ),
  );
  expect(created.name).toBe("Resolved");
  expect(transaction).toHaveBeenCalledTimes(2);
});

test("resolver failure never starts a transaction or applies the operation", async () => {
  const failure = new Error("Resolver unavailable");
  const transaction = vi.spyOn(db, "transaction");
  const apply = vi.fn(() => Effect.succeed("must not apply"));
  const transition = Transition.make({ resolve: Effect.fail(failure), apply });

  expect(await runtime.runPromise(Effect.flip(run(transition)))).toBe(failure);
  expect(transaction).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  expect(onCommitted).not.toHaveBeenCalled();
});

test("composes resolved transitions into one transaction and publishes only the final revisions", async () => {
  const transaction = vi.spyOn(db, "transaction");
  const order: string[] = [];
  const first = Transition.make({
    resolve: Effect.sync(() => {
      order.push("resolve dashboard");
      return "Dashboard";
    }),
    apply: (tx, name) => dashboard(name).apply(tx),
  });
  const second = Transition.make({
    resolve: Effect.sync(() => {
      order.push("resolve schedule");
      return "Schedule";
    }),
    apply: (tx, name) => schedule(name).apply(tx),
  });
  const combined = Transition.make({
    resolve: Effect.all({ first: first.resolve, second: second.resolve }),
    apply: (tx, resolved) =>
      Effect.gen(function* () {
        expect(order).toEqual(["resolve dashboard", "resolve schedule"]);
        const created = yield* first.apply(tx, resolved.first);
        const scheduled = yield* second.apply(tx, resolved.second);
        const updated = yield* dashboardResource.transitions
          .patch({
            id: created.id,
            expectedRevision: created.revision,
            operations: [{ op: "replace", path: "/name", value: "Renamed" }],
          })
          .apply(tx);
        const read = yield* dashboardResource.transitions
          .get(created.id)
          .apply(tx);
        expect(read).toEqual(updated);
        expect(onCommitted).not.toHaveBeenCalled();
        return { updated, scheduled };
      }),
  });

  const { updated, scheduled } = await runtime.runPromise(run(combined));
  expect(updated.revision).toBe(2);
  expect(scheduled.name).toBe("Schedule");
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(onCommitted).toHaveBeenCalledExactlyOnceWith([
    { table: "agent_schedule", id: scheduled.id, revision: 1 },
    { table: "dashboard", id: updated.id, revision: 2 },
  ]);
});

test("a later revision conflict rolls back every earlier transition and its notifications", async () => {
  const combined = Transition.from((tx) =>
    Effect.gen(function* () {
      const created = yield* dashboard("Rollback").apply(tx);
      yield* schedule("Rollback").apply(tx);
      yield* dashboardResource.transitions
        .patch({
          id: created.id,
          expectedRevision: created.revision + 1,
          operations: [{ op: "replace", path: "/name", value: "Never saved" }],
        })
        .apply(tx);
    }),
  );

  const failure = await runtime.runPromise(Effect.flip(run(combined)));
  expect(failure).toBeInstanceOf(RevisionConflict);
  await expectNoResources();
});

test("a stored-entity decoding defect rolls back the composed transaction", async () => {
  const insert = agentScheduleResource.store.insert;
  const corruptInsert = vi
    .spyOn(agentScheduleResource.store, "insert")
    .mockImplementation((tx, input) =>
      insert(tx, input).pipe(
        Effect.map((row) => ({ ...row, body: { invalid: true } })),
      ),
    );
  const combined = Transition.from((tx) =>
    Effect.gen(function* () {
      yield* dashboard("Rollback").apply(tx);
      yield* schedule("Corrupt result").apply(tx);
    }),
  );

  const result = await runtime.runPromise(Effect.exit(run(combined)));
  expect(corruptInsert).toHaveBeenCalledTimes(1);
  expect(Exit.hasDies(result)).toBe(true);
  await expectNoResources();
});

test("interruption during apply rolls back all composed writes", async () => {
  await runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const written = yield* Deferred.make<void>();
        const combined = Transition.from((tx) =>
          Effect.gen(function* () {
            yield* dashboard("Interrupted").apply(tx);
            yield* schedule("Interrupted").apply(tx);
            yield* Deferred.succeed(written, undefined);
            yield* Effect.never;
          }),
        );
        const fiber = yield* run(combined).pipe(Effect.forkScoped);
        yield* Deferred.await(written);
        yield* Fiber.interrupt(fiber);
      }),
    ),
  );
  await expectNoResources();
});
