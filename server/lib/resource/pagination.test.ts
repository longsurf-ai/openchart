// Purpose: Verifies bounded Resource pagination through the application router and real Stores.

import { router } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import { Database } from "@openchart/server/db";
import { chartResource } from "@openchart/server/resources/chart";
import { dashboardResource } from "@openchart/server/resources/dashboard";
import { dashboardTable } from "@openchart/server/resources/dashboard/schema";
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type ListPosition,
  listInputSchema,
  listPage,
} from "./pagination";
import * as Transactor from "./transactor";
import * as Transition from "./transition";

let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;

beforeEach(() => {
  runtime = makeRuntime({ home: temporaryHome(), databasePath: ":memory:" });
  caller = router.createCaller({ runtime });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

test.each(["createdAt", "updatedAt"] as const)(
  "%s orders the complete Resource directory before paging and retains deleted cursor positions",
  async (orderBy) => {
    const ids = Array.from(
      { length: 33 },
      (_, index) => `dsh_sort_${String(index).padStart(3, "0")}`,
    );
    await runtime.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service;
        yield* db.transaction((tx) =>
          tx.insert(dashboardTable).values(
            ids.map((id, index) => ({
              id,
              name: id,
              createdAt: 10 + Math.floor(index / 2),
              updatedAt: 100 - Math.floor(index / 2),
            })),
          ),
        );
      }),
    );
    const sorted = [...ids].sort((a, b) => {
      const left = ids.indexOf(a),
        right = ids.indexOf(b);
      const delta = Math.floor(right / 2) - Math.floor(left / 2);
      return (orderBy === "createdAt" ? delta : -delta) || b.localeCompare(a);
    });
    const first = await caller.resources.dashboard.list({
      limit: 15,
      order: "desc",
      orderBy,
    });
    expect(first.items.map((row) => row.id)).toEqual(sorted.slice(0, 15));
    await caller.resources.dashboard.delete({ id: first.items.at(-1)!.id });
    const idsAfter: string[] = [];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await caller.resources.dashboard.list({
        limit: 7,
        order: "desc",
        orderBy,
        cursor,
      });
      idsAfter.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
    }
    expect(idsAfter).toEqual(sorted.slice(15));
  },
);

test.each([0, 100, 205])(
  "listAll reads %i entities in order inside the caller transaction",
  async (count) => {
    const ids = Array.from(
      { length: count },
      (_, i) => `dsh_${String(i).padStart(3, "0")}`,
    );
    const entities = await runtime.runPromise(
      Transactor.run(
        Transition.from((tx) =>
          Effect.gen(function* () {
            if (ids.length) {
              yield* tx.insert(dashboardTable).values(
                [...ids].reverse().map((id, i) => ({
                  id,
                  name: id,
                  createdAt: i < count - 100 ? 200 : 100,
                  updatedAt: 200,
                })),
              );
            }
            // Uncommitted writes must be visible throughout the full traversal.
            return yield* dashboardResource.transitions.listAll().apply(tx);
          }),
        ),
      ),
    );
    expect(entities.map((entity) => entity.id)).toEqual(ids);
    expect(entities.map((entity) => entity.name)).toEqual(ids);
    expect(entities.every((entity) => entity.widgets.length === 0)).toBe(true);
  },
);

test("uses a bounded default and stable cursors through ties, edits, and deleted anchors", async () => {
  const ids = Array.from(
    { length: 103 },
    (_, i) => `dsh_${String(i).padStart(3, "0")}`,
  );
  await runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      yield* db.transaction((tx) =>
        tx.insert(dashboardTable).values(
          ids.map((id, i) => ({
            id,
            name: id,
            createdAt: i < 100 ? 100 : 200,
            updatedAt: 200,
          })),
        ),
      );
    }),
  );
  const list = vi.spyOn(dashboardResource.store, "list");
  const first = await caller.resources.dashboard.list();
  expect(first.items.map((item) => item.id)).toEqual(
    ids.slice(0, DEFAULT_PAGE_SIZE),
  );
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(list.mock.calls[0]?.[2]).toEqual({
    limit: DEFAULT_PAGE_SIZE + 1,
    cursor: undefined,
  });
  const anchor = first.items.at(-1)!;
  await caller.resources.dashboard.delete({ id: anchor.id });
  await caller.resources.dashboard.delete({ id: first.items[0]!.id });
  await caller.resources.dashboard.patch({
    id: first.items[1]!.id,
    expectedRevision: 1,
    operations: [{ op: "replace", path: "/name", value: "renamed" }],
  });
  const remaining: string[] = [];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await caller.resources.dashboard.list({ limit: 17, cursor });
    expect(page.items.length).toBeLessThanOrEqual(17);
    remaining.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  }
  expect(remaining).toEqual(ids.slice(DEFAULT_PAGE_SIZE));
  expect(list.mock.calls[1]?.[2]).toEqual({
    limit: 18,
    cursor: { createdAt: 100, updatedAt: 200, id: ids[49] },
  });
  expect(
    await caller.resources.dashboard.list({
      limit: MAX_PAGE_SIZE,
      cursor: Buffer.from(
        JSON.stringify({ createdAt: 200, updatedAt: 200, id: ids[102] }),
      ).toString("base64url"),
    }),
  ).toEqual({ items: [], nextCursor: null });
});

test("a descending window walks newest first with stable cursors through ties and deleted anchors", async () => {
  const ids = Array.from(
    { length: 103 },
    (_, i) => `dsh_${String(i).padStart(3, "0")}`,
  );
  await runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      yield* db.transaction((tx) =>
        tx.insert(dashboardTable).values(
          ids.map((id, i) => ({
            id,
            name: id,
            createdAt: i < 100 ? 100 : 200,
            updatedAt: 200,
          })),
        ),
      );
    }),
  );
  const readPage = (cursor?: ListPosition) =>
    runtime
      .runPromise(
        Transactor.run(
          Transition.from((tx) =>
            dashboardResource.store.list(
              tx,
              {},
              { limit: 18, cursor, order: "desc" },
            ),
          ),
        ),
      )
      .then((rows) => listPage(rows, 17));
  const first = await readPage();
  const newestFirst = [...ids].reverse();
  expect(first.items.map((row) => row.id)).toEqual(newestFirst.slice(0, 17));
  // The cursor keeps its ascending format and survives deletion of its row.
  expect(first.nextCursor).toEqual({
    createdAt: 100,
    updatedAt: 200,
    id: newestFirst[16],
  });
  await caller.resources.dashboard.delete({ id: newestFirst[16]! });
  const remaining: string[] = [];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await readPage(cursor);
    expect(page.items.length).toBeLessThanOrEqual(17);
    remaining.push(...page.items.map((row) => row.id));
    cursor = page.nextCursor;
  }
  expect(remaining).toEqual(newestFirst.slice(17));
  // The public list transition forwards the order to the Store.
  const throughRouter: string[] = [];
  let token: string | undefined;
  do {
    const page = await caller.resources.dashboard.list({
      order: "desc",
      limit: 17,
      ...(token ? { cursor: token } : {}),
    });
    throughRouter.push(...page.items.map((item) => item.id));
    token = page.nextCursor ?? undefined;
  } while (token);
  expect(throughRouter).toEqual(
    newestFirst.filter((id) => id !== newestFirst[16]),
  );
  // The same position continues forward when the direction is ascending.
  expect(
    await caller.resources.dashboard.list({
      limit: MAX_PAGE_SIZE,
      cursor: Buffer.from(JSON.stringify(first.nextCursor)).toString(
        "base64url",
      ),
    }),
  ).toMatchObject({ items: ids.slice(87).map((id) => ({ id })) });
});

test("list input accepts only asc or desc as its order", () => {
  const decode = Schema.decodeUnknownSync(listInputSchema(Schema.Struct({})));
  expect(decode({})).toEqual({});
  expect(decode({ order: "asc", limit: 1 })).toEqual({
    order: "asc",
    limit: 1,
  });
  expect(decode({ order: "desc" })).toEqual({ order: "desc" });
  for (const order of ["newest", "DESC", "", null, 1]) {
    expect(() => decode({ order })).toThrow();
  }
});

test("rejects invalid bounds, cursors, and filters before Store access", async () => {
  const list = vi.spyOn(dashboardResource.store, "list");
  for (const input of [
    { limit: 0 },
    { limit: -1 },
    { limit: 1.5 },
    { limit: MAX_PAGE_SIZE + 1 },
    { cursor: { createdAt: 0, updatedAt: 0, id: "dsh_a" } },
    { cursor: null },
    { cursor: "" },
    { cursor: "not a base64url token!" },
    { cursor: Buffer.from("{").toString("base64url") },
    ...[
      null,
      [],
      {},
      { createdAt: -1, updatedAt: 0, id: "dsh_a" },
      { createdAt: 0, updatedAt: 0 },
      { createdAt: 0, updatedAt: 0, id: "" },
      { createdAt: 0.5, updatedAt: 0, id: "dsh_a" },
      { createdAt: 0, updatedAt: -1, id: "dsh_a" },
      { createdAt: 0, updatedAt: 0.5, id: "dsh_a" },
      { createdAt: 0, updatedAt: 0, id: "dsh_a", extra: true },
    ].map((position) => ({
      cursor: Buffer.from(JSON.stringify(position)).toString("base64url"),
    })),
    { filter: { name: "hidden" } },
    { order: "newest" },
    { order: null },
    { orderBy: "name" },
    { orderBy: null },
    { extra: true },
  ]) {
    await expect(
      caller.resources.dashboard.list(input as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  expect(list).not.toHaveBeenCalled();
});

test("paginates existing joined Resources and applies filters before the row limit", async () => {
  const first = await caller.resources.dashboard.create({
    name: "first",
    widgets: [
      { id: "wdg_a", kind: "watchlist", layout: { x: 0, y: 0, w: 12, h: 16 } },
    ],
  });
  const second = await caller.resources.dashboard.create({ name: "second" });
  const charts = [];
  for (let i = 0; i < 3; i++) {
    await caller.resources.chart.create({
      dashboardId: second.id,
      preset: "1",
      cells: [],
      links: [],
    });
    charts.push(
      await caller.resources.chart.create({
        dashboardId: first.id,
        preset: "1",
        cells: [],
        links: [],
      }),
    );
  }
  const chartIds: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await caller.resources.chart.list({
      filter: { dashboardId: first.id },
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    chartIds.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(chartIds).toEqual(charts.map((item) => item.id));
  expect(
    await runtime.runPromise(
      Transactor.run(
        chartResource.transitions.listAll({
          filter: { dashboardId: first.id },
        }),
      ),
    ),
  ).toEqual(charts);
  expect((await caller.resources.dashboard.list({ limit: 1 })).items).toEqual([
    first,
  ]);
});
