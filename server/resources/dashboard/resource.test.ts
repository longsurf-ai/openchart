// Purpose: Proves the dashboard Resource end to end through the root tRPC router and the invalidation event.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { router } from "@openchart/server";
import { makeRuntime } from "@openchart/server/runtime";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import {
  ResourceStateInvalid,
  Transactor,
} from "@openchart/server/lib/resource";
import { ResourceChanged } from "@openchart/server/lib/resource/events";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Fiber,
  Schema,
  Stream,
} from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { DashboardEntity, DashboardId } from "./entity";
import { dashboardResource } from "./resource";
import { dashboardTable, dashboardWidgetTable } from "./schema";

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
  vi.restoreAllMocks();
  await runtime.dispose();
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error.code;
    throw error;
  }
  throw new Error("Expected the call to reject");
}

function storedWidgets() {
  return runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      return yield* db
        .select()
        .from(dashboardWidgetTable)
        .orderBy(
          asc(dashboardWidgetTable.dashboardId),
          asc(dashboardWidgetTable.position),
        );
    }),
  );
}

test("creates with defaults, reads, patches, lists, and deletes a dashboard", async () => {
  const created = await caller.resources.dashboard.create({ name: "Macro" });
  expect(dashboardResource.entity).toBe(DashboardEntity);
  expect(dashboardResource.id.create).toBe(DashboardId.create);
  expect(Schema.decodeUnknownSync(DashboardEntity)(created)).toEqual(created);
  expect(() =>
    Schema.decodeUnknownSync(DashboardEntity)({ name: "Macro" }),
  ).toThrow();
  expect(created.id).toMatch(/^dsh_/);
  expect(created.revision).toBe(1);
  expect(created.name).toBe("Macro");
  expect(created.favorite).toBe(false);
  expect(created.widgets).toEqual([]);
  expect(created.createdAt).toBe(created.updatedAt);

  await expect(
    caller.resources.dashboard.get({ id: created.id }),
  ).resolves.toEqual(created);

  const patched = await caller.resources.dashboard.patch({
    id: created.id,
    expectedRevision: 1,
    operations: [
      { op: "replace", path: "/name", value: "Rates" },
      { op: "replace", path: "/favorite", value: true },
      {
        op: "add",
        path: "/widgets/-",
        value: {
          id: "wdg_1",
          kind: "watchlist",
          resourceId: "wl_1",
          layout: { x: 0, y: 0, w: 12, h: 16 },
        },
      },
    ],
  });
  expect(patched.revision).toBe(2);
  expect(patched.name).toBe("Rates");
  expect(patched.favorite).toBe(true);
  expect(patched.widgets).toEqual([
    {
      id: "wdg_1",
      kind: "watchlist",
      resourceId: "wl_1",
      layout: { x: 0, y: 0, w: 12, h: 16 },
    },
  ]);
  expect(patched.createdAt).toBe(created.createdAt);
  expect(patched.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

  const listed = await caller.resources.dashboard.list();
  expect(listed).toEqual({ items: [patched], nextCursor: null });

  await caller.resources.dashboard.delete({ id: created.id });
  expect(await codeOf(caller.resources.dashboard.get({ id: created.id }))).toBe(
    "NOT_FOUND",
  );
  await expect(caller.resources.dashboard.list()).resolves.toEqual({
    items: [],
    nextCursor: null,
  });
});

test("rejects a stale revision without writing", async () => {
  const created = await caller.resources.dashboard.create({ name: "Macro" });
  expect(
    await codeOf(
      caller.resources.dashboard.patch({
        id: created.id,
        expectedRevision: 7,
        operations: [{ op: "replace", path: "/name", value: "Rates" }],
      }),
    ),
  ).toBe("CONFLICT");
  await expect(
    caller.resources.dashboard.get({ id: created.id }),
  ).resolves.toEqual(created);
});

test("uses SQLite time for create and widget-only updates despite a wrong JS clock", async () => {
  const startedAt = new Date().getTime();
  vi.spyOn(Date, "now").mockReturnValue(1);

  const created = await caller.resources.dashboard.create({ name: "DB time" });
  expect(created.createdAt).toBeGreaterThanOrEqual(startedAt);
  expect(created.updatedAt).toBe(created.createdAt);
  expect(Number.isInteger(created.createdAt)).toBe(true);

  // A historical timestamp ensures the update must refresh it, even when the
  // test's insert and patch happen within the same millisecond.
  await runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      yield* db.transaction((tx) =>
        tx
          .update(dashboardTable)
          .set({ updatedAt: 100 })
          .where(eq(dashboardTable.id, created.id)),
      );
    }),
  );
  const patched = await caller.resources.dashboard.patch({
    id: created.id,
    expectedRevision: 1,
    operations: [
      {
        op: "add",
        path: "/widgets/-",
        value: {
          id: "wdg_clock",
          kind: "feed",
          layout: { x: 0, y: 0, w: 12, h: 16 },
        },
      },
    ],
  });

  expect(patched.createdAt).toBe(created.createdAt);
  expect(patched.updatedAt).toBeGreaterThanOrEqual(startedAt);
  expect(patched.updatedAt).toBeLessThanOrEqual(new Date().getTime());
  expect(Number.isInteger(patched.updatedAt)).toBe(true);
  expect(patched.revision).toBe(2);
  await expect(
    caller.resources.dashboard.get({ id: created.id }),
  ).resolves.toEqual(patched);
});

test("persists widget order and nullable references, with deletion isolated to the owner", async () => {
  const created = await caller.resources.dashboard.create({
    name: "Macro",
    widgets: [
      {
        id: "wdg_z",
        kind: "watchlist",
        resourceId: "wl_missing",
        layout: { x: 0, y: 16, w: 12, h: 16 },
      },
      { id: "wdg_a", kind: "feed", layout: { x: 0, y: 0, w: 12, h: 16 } },
    ],
  });
  const other = await caller.resources.dashboard.create({
    name: "Other",
    widgets: [
      { id: "wdg_other", kind: "feed", layout: { x: 0, y: 0, w: 12, h: 16 } },
    ],
  });
  const moved = await caller.resources.dashboard.patch({
    id: created.id,
    expectedRevision: 1,
    operations: [{ op: "move", from: "/widgets/1", path: "/widgets/0" }],
  });

  expect(moved.revision).toBe(2);
  expect(moved.widgets).toEqual([
    { id: "wdg_a", kind: "feed", layout: { x: 0, y: 0, w: 12, h: 16 } },
    {
      id: "wdg_z",
      kind: "watchlist",
      resourceId: "wl_missing",
      layout: { x: 0, y: 16, w: 12, h: 16 },
    },
  ]);
  await expect(
    caller.resources.dashboard.get({ id: created.id }),
  ).resolves.toEqual(moved);
  await expect(caller.resources.dashboard.list()).resolves.toEqual({
    items: [moved, other],
    nextCursor: null,
  });
  expect(
    (await storedWidgets()).filter((row) => row.dashboardId === created.id),
  ).toEqual([
    {
      id: "wdg_a",
      x: 0,
      y: 0,
      w: 12,
      h: 16,
      dashboardId: created.id,
      position: 0,
      kind: "feed",
      resourceId: null,
    },
    {
      id: "wdg_z",
      x: 0,
      y: 16,
      w: 12,
      h: 16,
      dashboardId: created.id,
      position: 1,
      kind: "watchlist",
      resourceId: "wl_missing",
    },
  ]);

  await caller.resources.dashboard.delete({ id: created.id });
  await expect(storedWidgets()).resolves.toEqual([
    {
      id: "wdg_other",
      x: 0,
      y: 0,
      w: 12,
      h: 16,
      dashboardId: other.id,
      position: 0,
      kind: "feed",
      resourceId: null,
    },
  ]);
  await expect(
    caller.resources.dashboard.get({ id: other.id }),
  ).resolves.toEqual(other);
});

test("rolls back a create without publishing when the stored entity fails to decode", async () => {
  const insert = dashboardResource.store.insert;
  vi.spyOn(dashboardResource.store, "insert").mockImplementation((tx, input) =>
    insert(tx, input).pipe(Effect.map((row) => ({ ...row, updatedAt: -1 }))),
  );
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");

  await expect(
    caller.resources.dashboard.create({
      name: "Must roll back",
      widgets: [
        { id: "wdg_new", kind: "feed", layout: { x: 0, y: 32, w: 12, h: 16 } },
      ],
    }),
  ).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
    cause: expect.objectContaining({
      message: expect.stringContaining("failed its entity schema:"),
    }),
  });

  await expect(caller.resources.dashboard.list()).resolves.toEqual({
    items: [],
    nextCursor: null,
  });
  await expect(storedWidgets()).resolves.toEqual([]);
  expect(publish).not.toHaveBeenCalled();
});

test("rolls back metadata, revision, and widgets without publishing when a saved entity fails to decode", async () => {
  const created = await caller.resources.dashboard.create({
    name: "Original",
    widgets: [
      { id: "wdg_a", kind: "feed", layout: { x: 0, y: 0, w: 12, h: 16 } },
      { id: "wdg_b", kind: "watchlist", layout: { x: 0, y: 16, w: 12, h: 16 } },
    ],
  });
  const before = await storedWidgets();
  const save = dashboardResource.store.save;
  vi.spyOn(dashboardResource.store, "save").mockImplementation(
    (tx, id, input) =>
      save(tx, id, input).pipe(
        Effect.map((row) => ({ ...row, updatedAt: -1 })),
      ),
  );
  const events = await runtime.runPromise(Events.Service);
  const publish = vi.spyOn(events, "publish");

  await expect(
    caller.resources.dashboard.patch({
      id: created.id,
      expectedRevision: created.revision,
      operations: [
        { op: "replace", path: "/name", value: "Must roll back" },
        { op: "move", from: "/widgets/0", path: "/widgets/1" },
        {
          op: "add",
          path: "/widgets/-",
          value: {
            id: "wdg_new",
            kind: "feed",
            layout: { x: 0, y: 32, w: 12, h: 16 },
          },
        },
      ],
    }),
  ).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
    cause: expect.objectContaining({
      message: expect.stringContaining("failed its entity schema:"),
    }),
  });

  await expect(
    caller.resources.dashboard.get({ id: created.id }),
  ).resolves.toEqual(created);
  await expect(storedWidgets()).resolves.toEqual(before);
  expect(publish).not.toHaveBeenCalled();
});

test("rolls back metadata, revision, and replaced widget rows when a child write fails", async () => {
  const created = await caller.resources.dashboard.create({
    name: "Macro",
    widgets: [
      {
        id: "wdg_original",
        kind: "feed",
        layout: { x: 0, y: 0, w: 12, h: 16 },
      },
    ],
  });
  const other = await caller.resources.dashboard.create({
    name: "Other",
    widgets: [
      {
        id: "wdg_taken",
        kind: "watchlist",
        layout: { x: 0, y: 0, w: 12, h: 16 },
      },
    ],
  });
  const before = await storedWidgets();
  expect(
    await codeOf(
      caller.resources.dashboard.patch({
        id: created.id,
        expectedRevision: 1,
        operations: [
          { op: "replace", path: "/name", value: "Must roll back" },
          { op: "replace", path: "/widgets/0/id", value: "wdg_taken" },
        ],
      }),
    ),
  ).toBe("INTERNAL_SERVER_ERROR");
  await expect(caller.resources.dashboard.list()).resolves.toEqual({
    items: [created, other],
    nextCursor: null,
  });
  await expect(storedWidgets()).resolves.toEqual(before);

  expect(
    await codeOf(
      caller.resources.dashboard.create({
        name: "Must not exist",
        widgets: [
          {
            id: "wdg_taken",
            kind: "feed",
            layout: { x: 0, y: 0, w: 12, h: 16 },
          },
        ],
      }),
    ),
  ).toBe("INTERNAL_SERVER_ERROR");
  await expect(caller.resources.dashboard.list()).resolves.toEqual({
    items: [created, other],
    nextCursor: null,
  });
});

test("distinguishes rejected operations from invalid final state without writing", async () => {
  const created = await caller.resources.dashboard.create({ name: "Macro" });
  await expect(
    caller.resources.dashboard.patch({
      id: created.id,
      expectedRevision: 1,
      operations: [{ op: "replace", path: "/missing", value: 1 }],
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    cause: expect.objectContaining({
      _tag: "Resource.PatchRejected",
      index: 0,
      op: "replace",
      path: "/missing",
    }),
  });
  await expect(
    caller.resources.dashboard.patch({
      id: created.id,
      expectedRevision: 1,
      operations: [{ op: "remove", path: "/name" }],
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    cause: expect.any(ResourceStateInvalid),
    message: expect.stringContaining("dashboard state is invalid:"),
  });
  expect(
    await codeOf(
      caller.resources.dashboard.patch({
        id: created.id,
        expectedRevision: 1,
        operations: [{ op: "add", path: "/revision", value: 99 }],
      }),
    ),
  ).toBe("BAD_REQUEST");
  await expect(
    caller.resources.dashboard.get({ id: created.id }),
  ).resolves.toEqual(created);
});

test("rejects invalid create input at the wire boundary", async () => {
  expect(await codeOf(caller.resources.dashboard.create({ name: "" }))).toBe(
    "BAD_REQUEST",
  );
  expect(
    await codeOf(
      caller.resources.dashboard.create({ name: "x".repeat(201) } as {
        name: string;
      }),
    ),
  ).toBe("BAD_REQUEST");
  expect(
    await codeOf(caller.resources.dashboard.get({ id: "chart_1" as never })),
  ).toBe("BAD_REQUEST");
});

test("rejects missing, fractional, out-of-grid, duplicate and overlapping placements without writing", async () => {
  const first = {
    id: "wdg_first",
    kind: "chart",
    resourceId: "cht_saved",
    layout: { x: 0, y: 0, w: 6, h: 8 },
  };
  const second = {
    id: "wdg_second",
    kind: "other",
    layout: { x: 6, y: 0, w: 6, h: 8 },
  };
  const created = await caller.resources.dashboard.create({
    name: "Geometry",
    widgets: [first, second],
  });
  const candidates = [
    [{ id: first.id, kind: first.kind }],
    [{ ...first, layout: { ...first.layout, x: 0.5 } }],
    [{ ...first, layout: { ...first.layout, y: -1 } }],
    [{ ...first, layout: { ...first.layout, w: 0 } }],
    [{ ...first, layout: { ...first.layout, h: 0.5 } }],
    [{ ...first, layout: { ...first.layout, x: 7 } }],
    [first, { ...second, id: first.id }],
    [first, { ...second, layout: { ...second.layout, x: 5 } }],
  ];
  for (const widgets of candidates) {
    await expect(
      caller.resources.dashboard.patch({
        id: created.id,
        expectedRevision: created.revision,
        operations: [{ op: "replace", path: "/widgets", value: widgets }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.resources.dashboard.get({ id: created.id }),
    ).resolves.toEqual(created);
  }
  const moved = await caller.resources.dashboard.patch({
    id: created.id,
    expectedRevision: created.revision,
    operations: [
      {
        op: "replace",
        path: "/widgets/1/layout",
        value: { x: 0, y: 8, w: 12, h: 16 },
      },
    ],
  });
  expect(moved.revision).toBe(created.revision + 1);
  expect(moved.widgets[1]?.layout).toEqual({ x: 0, y: 8, w: 12, h: 16 });
});

test("publishes resource.changed after every committed write", async () => {
  const collected = await runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* Events.Service;
        const live = yield* events.allBounded(256);
        const fiber = yield* live.pipe(
          Stream.filter((event) => event.type === ResourceChanged.type),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkScoped,
        );

        const created = yield* Effect.promise(() =>
          caller.resources.dashboard.create({ name: "Macro" }),
        );
        yield* Effect.promise(() =>
          caller.resources.dashboard.patch({
            id: created.id,
            expectedRevision: 1,
            operations: [{ op: "replace", path: "/name", value: "Rates" }],
          }),
        );
        yield* Effect.promise(() =>
          caller.resources.dashboard.delete({ id: created.id }),
        );

        const payloads = Array.from(yield* Fiber.join(fiber));
        return { id: created.id, payloads };
      }),
    ),
  );

  expect(collected.payloads.map((payload) => payload.data)).toEqual([
    { resource: "dashboard", id: collected.id, revision: 1 },
    { resource: "dashboard", id: collected.id, revision: 2 },
    { resource: "dashboard", id: collected.id, revision: 2 },
  ]);
});

test("allows one workspace per dashboard and rejects a second placement atomically", async () => {
  const widget = (id: string, y: number) => ({
    id,
    kind: "workspace",
    layout: { x: 0, y, w: 12, h: 8 },
  });
  const dashboard = await caller.resources.dashboard.create({
    name: "Authoring",
    widgets: [widget("wdg_first", 0)],
  });
  await expect(
    caller.resources.dashboard.patch({
      id: dashboard.id,
      expectedRevision: dashboard.revision,
      operations: [
        { op: "add", path: "/widgets/-", value: widget("wdg_second", 8) },
      ],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await caller.resources.dashboard.get({ id: dashboard.id })).toEqual(
    dashboard,
  );
  await expect(
    caller.resources.dashboard.create({
      name: "Another",
      widgets: [widget("wdg_third", 0)],
    }),
  ).resolves.toMatchObject({ name: "Another" });
});

test.each([
  ["chart", undefined, "dashboard.chart_reference"],
  ["chart", "wsp_wrong_kind", "dashboard.chart_reference"],
] as const)(
  "rejects %s placements referencing %s on create and patch",
  async (kind, resourceId, code) => {
    const widget = {
      id: "wdg_reference",
      kind,
      ...(resourceId === undefined ? {} : { resourceId }),
      layout: { x: 0, y: 0, w: 12, h: 8 },
    };
    const dashboard = await caller.resources.dashboard.create({
      name: "References",
    });
    const { db } = await runtime.runPromise(Database.Service);
    const before = await storedWidgets();
    const publish = vi.spyOn(
      await runtime.runPromise(Events.Service),
      "publish",
    );
    const insert = vi.spyOn(dashboardResource.store, "insert");
    const save = vi.spyOn(dashboardResource.store, "save");
    await expect(
      caller.resources.dashboard.create({ name: "Invalid", widgets: [widget] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const rejected = await runtime.runPromiseExit(
      Transactor.run(
        dashboardResource.transitions.patch({
          id: dashboard.id,
          expectedRevision: dashboard.revision,
          operations: [{ op: "add", path: "/widgets/-", value: widget }],
        }),
      ),
    );
    if (Exit.isSuccess(rejected)) throw new Error("Expected invalid reference");
    expect(Cause.squash(rejected.cause)).toMatchObject({
      issues: [
        { code, path: "/widgets/0/resourceId", message: expect.any(String) },
      ],
    });
    expect(insert).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(await storedWidgets()).toEqual(before);
    expect(await caller.resources.dashboard.get({ id: dashboard.id })).toEqual(
      dashboard,
    );
    expect(
      await runtime.runPromise(db.select().from(dashboardTable)),
    ).toHaveLength(1);
  },
);

test("chart references may repeat within and across dashboards", async () => {
  const widgets = ["cht_first", "cht_second"].map((resourceId, index) => ({
    id: `wdg_${index}`,
    kind: "chart",
    resourceId,
    layout: { x: index * 6, y: 0, w: 6, h: 8 },
  }));
  const dashboard = await caller.resources.dashboard.create({
    name: "Charts",
    widgets,
  });
  const repeated = await caller.resources.dashboard.patch({
    id: dashboard.id,
    expectedRevision: dashboard.revision,
    operations: [
      { op: "replace", path: "/widgets/1/resourceId", value: "cht_first" },
    ],
  });
  expect(repeated.widgets.map((widget) => widget.resourceId)).toEqual([
    "cht_first",
    "cht_first",
  ]);
  expect(repeated.revision).toBe(dashboard.revision + 1);
  // References are not ownership: unavailable targets and references in other dashboards remain valid.
  const otherWidgets = repeated.widgets.map((widget) => ({
    ...widget,
    id: `${widget.id}_other`,
  }));
  await expect(
    caller.resources.dashboard.create({ name: "Other", widgets: otherWidgets }),
  ).resolves.toMatchObject({ widgets: otherWidgets });
});

test("widget kinds remain open and changing a reference kind is atomic", async () => {
  const widgets = [
    { id: "wdg_alerts", kind: "alerts", layout: { x: 0, y: 0, w: 6, h: 8 } },
    {
      id: "wdg_future",
      kind: "future-widget",
      resourceId: "external-reference",
      layout: { x: 6, y: 0, w: 6, h: 8 },
    },
  ];
  const dashboard = await caller.resources.dashboard.create({
    name: "Open kinds",
    widgets,
  });
  const changed = await caller.resources.dashboard.patch({
    id: dashboard.id,
    expectedRevision: dashboard.revision,
    operations: [
      { op: "replace", path: "/widgets/1/kind", value: "workspace" },
      { op: "replace", path: "/widgets/1/resourceId", value: "wsp_retained" },
    ],
  });
  expect(changed.widgets[1]).toMatchObject({
    kind: "workspace",
    resourceId: "wsp_retained",
  });
});
