// Purpose: Proves committed-change callbacks include cascades and exclude rolled-back or uncommitted writes.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { Deferred, Effect, Exit, Fiber, ManagedRuntime } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Database } from "@openchart/server/db";

function makeRuntime(onCommitted: Database.OnCommitted, filename = ":memory:") {
  return ManagedRuntime.make(Database.layer(filename, onCommitted));
}

let runtime: ReturnType<typeof makeRuntime>;
let db: Database.Client;
let onCommitted: ReturnType<typeof vi.fn<Database.OnCommitted>>;

beforeEach(async () => {
  onCommitted = vi.fn<Database.OnCommitted>(() => Effect.void);
  runtime = makeRuntime(onCommitted);
  db = (await runtime.runPromise(Database.Service)).db;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

function changes() {
  return onCommitted.mock.calls.flatMap(([batch]) => batch);
}

function insertDashboard(id: string) {
  return sql`INSERT INTO dashboard (id, name) VALUES (${id}, 'Example')`;
}

async function expectEmptyBuffer() {
  expect(
    await runtime.runPromise(db.all(sql`SELECT * FROM resource_event_buffer`)),
  ).toEqual([]);
  expect(
    await runtime.runPromise(
      db.all(sql`SELECT * FROM resource_event_transaction`),
    ),
  ).toEqual([]);
}

test("detects SQL writes without a Store and coalesces revisions after commit", async () => {
  await runtime.runPromise(
    db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.run(insertDashboard("dsh_one"));
        expect(changes()).toEqual([]);
      }),
    ),
  );
  expect(changes()).toEqual([
    { table: "dashboard", id: "dsh_one", revision: 1 },
  ]);
  onCommitted.mockClear();

  await runtime.runPromise(
    db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.run(sql`UPDATE dashboard SET revision = 2`);
        yield* tx.run(sql`UPDATE dashboard SET revision = 3`);
        expect(changes()).toEqual([]);
      }),
    ),
  );
  expect(changes()).toEqual([
    { table: "dashboard", id: "dsh_one", revision: 3 },
  ]);
  onCommitted.mockClear();

  await runtime.runPromise(
    db.transaction((tx) => tx.run(sql`DELETE FROM dashboard`)),
  );
  expect(changes()).toEqual([
    { table: "dashboard", id: "dsh_one", revision: 3 },
  ]);
  await expectEmptyBuffer();
});

test("captures only affected Resource roots on cascade, even without a chart Resource registration", async () => {
  await runtime.runPromise(
    db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.run(insertDashboard("dsh_one"));
        yield* tx.run(insertDashboard("dsh_other"));
        yield* tx.run(sql`
          INSERT INTO chart (id, dashboard_id, revision) VALUES
            ('cht_a', 'dsh_one', 2), ('cht_b', 'dsh_one', 4),
            ('cht_other', 'dsh_other', 1)
        `);
        yield* tx.run(sql`
          INSERT INTO dashboard_widget (id, dashboard_id, position, kind, x, y, w, h)
          VALUES ('wdg_one', 'dsh_one', 0, 'feed', 0, 0, 12, 16)
        `);
      }),
    ),
  );
  onCommitted.mockClear();
  const remove = db.transaction((tx) =>
    tx.run(sql`DELETE FROM dashboard WHERE id = 'dsh_one'`),
  );

  const rolledBack = await runtime.runPromise(
    Effect.exit(
      db.transaction(() =>
        remove.pipe(Effect.andThen(Effect.fail("cancel deletion"))),
      ),
    ),
  );
  expect(Exit.isFailure(rolledBack)).toBe(true);
  expect(changes()).toEqual([]);
  await expectEmptyBuffer();

  await runtime.runPromise(remove);
  expect(changes()).toEqual([
    { table: "chart", id: "cht_a", revision: 2 },
    { table: "chart", id: "cht_b", revision: 4 },
    { table: "dashboard", id: "dsh_one", revision: 1 },
  ]);
  expect(await runtime.runPromise(db.all(sql`SELECT id FROM chart`))).toEqual([
    { id: "cht_other" },
  ]);
  expect(
    await runtime.runPromise(db.all(sql`SELECT * FROM dashboard_widget`)),
  ).toEqual([]);
  await expectEmptyBuffer();
});

test("savepoint rollback restores the buffered revision and outer rollback discards nested success", async () => {
  await runtime.runPromise(
    db.transaction((tx) => tx.run(insertDashboard("dsh_one"))),
  );
  onCommitted.mockClear();

  await runtime.runPromise(
    db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.run(sql`UPDATE dashboard SET revision = 2`);
        const inner = yield* Effect.exit(
          tx.transaction((nested) =>
            nested
              .run(sql`UPDATE dashboard SET revision = 3`)
              .pipe(Effect.andThen(Effect.fail("cancel savepoint"))),
          ),
        );
        expect(Exit.isFailure(inner)).toBe(true);
        expect(changes()).toEqual([]);
      }),
    ),
  );
  expect(changes()).toEqual([
    { table: "dashboard", id: "dsh_one", revision: 2 },
  ]);
  onCommitted.mockClear();

  await runtime.runPromise(
    Effect.exit(
      db.transaction((tx) =>
        tx
          .transaction((nested) =>
            nested.run(sql`UPDATE dashboard SET revision = 4`),
          )
          .pipe(
            Effect.tap(() => Effect.sync(() => expect(changes()).toEqual([]))),
            Effect.andThen(Effect.fail("cancel outer transaction")),
          ),
      ),
    ),
  );
  expect(changes()).toEqual([]);
  expect(
    await runtime.runPromise(db.all(sql`SELECT revision FROM dashboard`)),
  ).toEqual([{ revision: 2 }]);
  await expectEmptyBuffer();
});

test("serializes concurrent transactions without leaking rolled-back changes", async () => {
  const result = await runtime.runPromise(
    Effect.all(
      [
        db.transaction((tx) =>
          tx
            .run(insertDashboard("dsh_committed"))
            .pipe(Effect.andThen(Effect.yieldNow)),
        ),
        Effect.exit(
          db.transaction((tx) =>
            tx
              .run(insertDashboard("dsh_rolled_back"))
              .pipe(
                Effect.andThen(Effect.fail("cancel concurrent transaction")),
              ),
          ),
        ),
      ],
      { concurrency: "unbounded" },
    ),
  );
  expect(Exit.isFailure(result[1])).toBe(true);
  expect(changes()).toEqual([
    { table: "dashboard", id: "dsh_committed", revision: 1 },
  ]);
  await expectEmptyBuffer();
});

test("interruption rolls back captured writes before the next transaction", async () => {
  await runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const fiber = yield* db
          .transaction((tx) =>
            tx
              .run(insertDashboard("dsh_interrupted"))
              .pipe(
                Effect.andThen(Deferred.succeed(started, undefined)),
                Effect.andThen(Effect.never),
              ),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        yield* db.transaction((tx) => tx.run(insertDashboard("dsh_after")));
      }),
    ),
  );
  expect(changes()).toEqual([
    { table: "dashboard", id: "dsh_after", revision: 1 },
  ]);
  expect(
    await runtime.runPromise(db.all(sql`SELECT id FROM dashboard`)),
  ).toEqual([{ id: "dsh_after" }]);
  await expectEmptyBuffer();
});

test("rejects untracked autocommit writes and emits nothing for reads or no matching rows", async () => {
  const rejected = await runtime.runPromise(
    Effect.exit(db.run(insertDashboard("dsh_outside"))),
  );
  expect(Exit.isFailure(rejected)).toBe(true);
  await runtime.runPromise(
    db.transaction((tx) =>
      Effect.gen(function* () {
        expect(yield* tx.all(sql`SELECT * FROM dashboard`)).toEqual([]);
        yield* tx.run(sql`UPDATE dashboard SET revision = 2`);
        yield* tx.run(sql`DELETE FROM dashboard`);
      }),
    ),
  );
  expect(changes()).toEqual([]);
  await expectEmptyBuffer();
});

test("commit failure publishes nothing and does not poison the next transaction", async () => {
  const failed = await runtime.runPromise(
    Effect.exit(
      db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.run(sql`PRAGMA defer_foreign_keys = ON`);
          yield* tx.run(insertDashboard("dsh_uncommitted"));
          yield* tx.run(sql`
            INSERT INTO chart (id, dashboard_id) VALUES ('cht_bad', 'dsh_missing')
          `);
        }),
      ),
    ),
  );
  expect(Exit.isFailure(failed)).toBe(true);
  expect(changes()).toEqual([]);
  await runtime.runPromise(
    db.transaction((tx) => tx.run(insertDashboard("dsh_after_failure"))),
  );
  expect(changes()).toEqual([
    { table: "dashboard", id: "dsh_after_failure", revision: 1 },
  ]);
  expect(
    await runtime.runPromise(db.all(sql`SELECT id FROM dashboard`)),
  ).toEqual([{ id: "dsh_after_failure" }]);
  await expectEmptyBuffer();
});

test("recreates detectors on reopen without persisting buffers, triggers, or replaying rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "resource-detector-"));
  const filename = join(directory, "application.sqlite3");
  try {
    for (const pass of [1, 2]) {
      const spy = vi.fn<Database.OnCommitted>(() => Effect.void);
      const reopened = makeRuntime(spy, filename);
      try {
        const connection = (await reopened.runPromise(Database.Service)).db;
        expect(spy).not.toHaveBeenCalled();
        const rows = await reopened.runPromise(
          connection.all(sql`SELECT id FROM dashboard ORDER BY id`),
        );
        expect(rows).toHaveLength(pass - 1);
        await reopened.runPromise(
          connection.transaction((tx) =>
            tx.run(insertDashboard(`dsh_${pass}`)),
          ),
        );
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]?.[0]?.[0]).toEqual({
          table: "dashboard",
          id: `dsh_${pass}`,
          revision: 1,
        });
      } finally {
        await reopened.dispose();
      }
    }
    const stored = new DatabaseSync(filename, { readOnly: true });
    try {
      expect(
        stored
          .prepare(
            `
        SELECT name FROM sqlite_schema WHERE name LIKE 'resource_event_%'
      `,
          )
          .all(),
      ).toEqual([]);
    } finally {
      stored.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
