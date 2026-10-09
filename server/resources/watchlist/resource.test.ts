// Purpose: Proves the watchlist Resource and its recursive section tree end to end through the root tRPC router.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { router } from "@openchart/server";
import { makeRuntime } from "@openchart/server/runtime";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import { TRPCError } from "@trpc/server";
import { asc } from "drizzle-orm";
import {
  ConfigProvider,
  Effect,
  Fiber,
  JsonSchema,
  Schema,
  Stream,
} from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import { WatchlistEntity } from "./entity";
import { watchlistResource } from "./resource";
import { watchlistItemTable, watchlistSectionTable } from "./schema";

type Runtime = ReturnType<typeof makeRuntime>;
type Caller = ReturnType<typeof router.createCaller>;

let runtime: Runtime;
let caller: Caller;

beforeEach(() => {
  runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  caller = router.createCaller({ runtime });
});

afterEach(async () => {
  await runtime.dispose();
});

const row = (id: string, symbol: string) => ({
  id,
  provider: "yfinance",
  listing: { symbol, currency: "USD" },
});

const tree = [
  {
    id: "wsc_tech",
    name: "Tech",
    items: [row("wit_aapl", "AAPL"), row("wit_msft", "MSFT")],
    sections: [
      {
        id: "wsc_chips",
        name: "Chips",
        items: [row("wit_nvda", "NVDA")],
        sections: [
          { id: "wsc_fabs", items: [row("wit_tsm", "TSM")], sections: [] },
        ],
      },
    ],
  },
  {
    id: "wsc_energy",
    name: "Energy",
    items: [row("wit_xom", "XOM")],
    sections: [],
  },
];

function storedTree() {
  return runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      const sections = yield* db
        .select({
          id: watchlistSectionTable.id,
          parent: watchlistSectionTable.parentSectionId,
          position: watchlistSectionTable.position,
        })
        .from(watchlistSectionTable)
        .orderBy(asc(watchlistSectionTable.id));
      const items = yield* db
        .select({
          id: watchlistItemTable.id,
          section: watchlistItemTable.sectionId,
          position: watchlistItemTable.position,
        })
        .from(watchlistItemTable)
        .orderBy(asc(watchlistItemTable.id));
      return { sections, items };
    }),
  );
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error.code;
    throw error;
  }
  throw new Error("Expected the call to reject");
}

test("creates with defaults, reads, lists, and deletes a watchlist", async () => {
  const empty = await caller.resources.watchlist.create({ name: "Empty" });
  expect(empty).toMatchObject({ name: "Empty", columns: [], sections: [] });
  expect(Schema.decodeUnknownSync(WatchlistEntity)(empty)).toEqual(empty);

  const created = await caller.resources.watchlist.create({
    name: "Markets",
    columns: [{ id: "wcl_price", metric: { kind: "price" } }],
    sections: tree,
  });
  expect(created.sections[0]?.sections[0]?.sections[0]).toEqual({
    id: "wsc_fabs",
    items: [row("wit_tsm", "TSM")],
    sections: [],
  });
  await expect(
    caller.resources.watchlist.get({ id: created.id }),
  ).resolves.toEqual(created);
  expect(
    (await caller.resources.watchlist.list()).items.map(({ id }) => id),
  ).toEqual([empty.id, created.id]);

  await caller.resources.watchlist.delete({ id: created.id });
  expect(await storedTree()).toEqual({ sections: [], items: [] });
});

test("stores sibling positions and parent links, and moves a subtree in one operation", async () => {
  const created = await caller.resources.watchlist.create({
    name: "Markets",
    sections: tree,
  });
  expect((await storedTree()).sections).toEqual([
    { id: "wsc_chips", parent: "wsc_tech", position: 0 },
    { id: "wsc_energy", parent: null, position: 1 },
    { id: "wsc_fabs", parent: "wsc_chips", position: 0 },
    { id: "wsc_tech", parent: null, position: 0 },
  ]);

  const patched = await caller.resources.watchlist.patch({
    id: created.id,
    expectedRevision: 1,
    operations: [
      // Chips and its Fabs subtree become the first top-level section.
      { op: "move", from: "/sections/0/sections/0", path: "/sections/0" },
      // A row moves from the top of Tech into Energy.
      { op: "move", from: "/sections/1/items/0", path: "/sections/2/items/0" },
    ],
  });
  expect(patched.revision).toBe(2);
  expect(patched.sections.map(({ id }) => id)).toEqual([
    "wsc_chips",
    "wsc_tech",
    "wsc_energy",
  ]);
  expect(patched.sections[0]?.sections.map(({ id }) => id)).toEqual([
    "wsc_fabs",
  ]);
  expect(patched.sections[2]?.items.map(({ id }) => id)).toEqual([
    "wit_aapl",
    "wit_xom",
  ]);
  await expect(
    caller.resources.watchlist.get({ id: created.id }),
  ).resolves.toEqual(patched);
  expect(await storedTree()).toEqual({
    sections: [
      { id: "wsc_chips", parent: null, position: 0 },
      { id: "wsc_energy", parent: null, position: 2 },
      { id: "wsc_fabs", parent: "wsc_chips", position: 0 },
      { id: "wsc_tech", parent: null, position: 1 },
    ],
    items: [
      { id: "wit_aapl", section: "wsc_energy", position: 0 },
      { id: "wit_msft", section: "wsc_tech", position: 0 },
      { id: "wit_nvda", section: "wsc_chips", position: 0 },
      { id: "wit_tsm", section: "wsc_fabs", position: 0 },
      { id: "wit_xom", section: "wsc_energy", position: 1 },
    ],
  });
});

test("rejects a listing repeated anywhere in the tree without writing", async () => {
  const created = await caller.resources.watchlist.create({
    name: "Markets",
    sections: tree,
  });
  const before = await storedTree();
  expect(
    await codeOf(
      caller.resources.watchlist.patch({
        id: created.id,
        expectedRevision: 1,
        operations: [
          {
            op: "add",
            path: "/sections/0/sections/0/sections/0/items/-",
            value: row("wit_again", "AAPL"),
          },
        ],
      }),
    ),
  ).toBe("BAD_REQUEST");
  await expect(
    caller.resources.watchlist.get({ id: created.id }),
  ).resolves.toEqual(created);
  expect(await storedTree()).toEqual(before);
});

test("exposes the recursive section schema to the Agent as one definition", () => {
  const document = JsonSchema.toDocumentDraft07(
    Schema.toJsonSchemaDocument(watchlistResource.createSchema),
  );
  expect(document.definitions.WatchlistSection).toMatchObject({
    properties: {
      sections: {
        type: "array",
        items: { $ref: "#/definitions/WatchlistSection" },
      },
    },
  });
});

test("publishes resource.changed for nested-only writes", async () => {
  const { id, payloads } = await runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* Events.Service;
        const live = yield* events.allBounded(256);
        const fiber = yield* live.pipe(
          Stream.filter((event) => event.type === ResourceChanged.type),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkScoped,
        );
        const created = yield* Effect.promise(() =>
          caller.resources.watchlist.create({
            name: "Markets",
            sections: tree,
          }),
        );
        yield* Effect.promise(() =>
          caller.resources.watchlist.patch({
            id: created.id,
            expectedRevision: 1,
            operations: [
              { op: "remove", path: "/sections/0/sections/0/sections/0" },
            ],
          }),
        );
        return {
          id: created.id,
          payloads: Array.from(yield* Fiber.join(fiber)),
        };
      }),
    ),
  );
  expect(payloads.map((event) => event.data)).toEqual([
    { resource: "watchlist", id, revision: 1 },
    { resource: "watchlist", id, revision: 2 },
  ]);
});
