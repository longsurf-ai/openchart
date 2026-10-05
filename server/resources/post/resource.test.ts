// Purpose: Verifies publication identity, durable multimedia, provenance filtering, and retained quotes.
import { router, createRequestHandler } from "@openchart/server";
import { createServer as createHttpServer } from "node:http";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { Database } from "@openchart/server/db";
import { temporaryHome } from "@openchart/server/home.test-utils";
import {
  ResourceStateInvalid,
  Transactor,
} from "@openchart/server/lib/resource";
import { makeRuntime } from "@openchart/server/runtime";
import { Effect } from "effect";
import { SessionId } from "@openchart/server/agent/contracts/session";
import { AlertRuleId } from "@openchart/server/resources/alert-rule/entity";
import { AlertEventId } from "@openchart/server/resources/alert-event/entity";
import { afterEach, beforeEach, expect, expectTypeOf, test } from "vitest";
import type { inferRouterInputs } from "@trpc/server";
import { postResource, lookupPublishedPost } from "./resource";
import { type PostPublication, PostId, postMedia, posts } from "./schema";
import { publishPost } from "./transitions/publish";
import { postStore } from "./store";

let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;
beforeEach(() => {
  runtime = makeRuntime({ home: temporaryHome(), databasePath: ":memory:" });
  caller = router.createCaller({ runtime });
});
afterEach(() => runtime.dispose());
const origin: PostPublication["origin"] = {
  kind: "agent_run",
  runId: "agr_one",
  sessionId: SessionId.make("ses_child"),
  alert: {
    eventId: AlertEventId.make("ale_event"),
    ruleId: AlertRuleId.make("alr_rule"),
  },
};
const input = (
  key: string,
  overrides: Partial<PostPublication> = {},
): PostPublication => ({
  publicationKey: key,
  author: { kind: "provider", providerId: "claude-code" },
  origin,
  content: [{ type: "text", text: "**Analysis**" }],
  quotedPostId: null,
  ...overrides,
});
const publish = (value: PostPublication) =>
  runtime.runPromise(Transactor.run(publishPost(value)));

test("internal publication rejects overlong assembled content without saving a Post or media", async () => {
  await expect(
    publish(
      input("oversized", {
        content: [
          { type: "text", text: "a".repeat(350) },
          {
            type: "media",
            mime: "image/png",
            filename: "chart.png",
            bytes: Buffer.from("image"),
            description: "x",
          },
        ],
      }),
    ),
  ).rejects.toBeInstanceOf(ResourceStateInvalid);
  expect((await caller.resources.post.list()).items).toEqual([]);
  expect(
    await runtime.runPromise(
      Effect.flatMap(Database.Service, ({ db }) => db.select().from(postMedia)),
    ),
  ).toEqual([]);
  expect((await publish(input("oversized"))).content).toEqual([
    { type: "text", text: "**Analysis**" },
  ]);
});

test("Feed includes ordinary and scheduled Agent publications alongside alert Posts", async () => {
  const alert = await publish(input("generic:alert"));
  const ordinary = await publish(
    input("generic:chat", {
      origin: {
        kind: "agent_run",
        runId: "agr_chat",
        sessionId: SessionId.make("ses_chat"),
        alert: null,
      },
      content: [{ type: "text", text: "Project update" }],
    }),
  );
  const scheduled = await publish(
    input("generic:schedule", {
      origin: {
        kind: "agent_run",
        runId: "agr_scheduled",
        sessionId: SessionId.make("ses_scheduled"),
        alert: null,
      },
      content: [{ type: "text", text: "Morning digest" }],
      quotedPostId: ordinary.id,
    }),
  );
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await caller.resources.post.feed({
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.items.map(({ post }) => post.id));
    const quote = page.items.find(
      ({ post }) => post.id === scheduled.id,
    )?.quotedPost;
    if (quote) expect(quote.id).toBe(ordinary.id);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(new Set(ids)).toEqual(new Set([alert.id, ordinary.id, scheduled.id]));
  expect(ids).toHaveLength(3);
  expect(
    (
      await caller.resources.post.feed({
        search: "PROJECT",
        unread: { after: 0, excludeIds: [alert.id] },
      })
    ).items.map(({ post }) => post.id),
  ).toEqual([ordinary.id]);
  expect(
    (await caller.resources.post.feed({ ruleId: "alr_rule" })).items.map(
      ({ post }) => post.id,
    ),
  ).toEqual([alert.id]);
});

test("search matches saved authors and content literally before pagination and composes with unread", async () => {
  const first = await publish(
    input("search:first", {
      content: [{ type: "text", text: "AAPL gained 2%_ today" }],
    }),
  );
  const second = await publish(
    input("search:second", {
      author: { kind: "provider", providerId: "aapl-analyst" },
      content: [{ type: "text", text: "Volume confirmation" }],
    }),
  );
  await publish(input("search:unrelated"));
  const page = await caller.resources.post.feed({
    search: "  aApL  ",
    limit: 1,
  });
  expect(page.items.map(({ post }) => post.id)).toEqual([second.id]);
  expect(page.nextCursor).not.toBeNull();
  const next = await caller.resources.post.feed({
    search: "AAPL",
    limit: 1,
    cursor: page.nextCursor!,
  });
  expect(next.items.map(({ post }) => post.id)).toEqual([first.id]);
  expect(next.nextCursor).toBeNull();
  const unread = await caller.resources.post.feed({
    search: "aapl",
    unread: { after: 0, excludeIds: [second.id] },
  });
  expect(unread.items.map(({ post }) => post.id)).toEqual([first.id]);
  expect(
    (await caller.resources.post.feed({ search: "%_" })).items.map(
      ({ post }) => post.id,
    ),
  ).toEqual([first.id]);
  expect(
    (await caller.resources.post.feed({ search: "' OR 1=1 --" })).items,
  ).toEqual([]);
  expect(
    (await caller.resources.post.feed({ search: "  " })).items,
  ).toHaveLength(3);
  await expect(
    caller.resources.post.feed({ search: "x".repeat(201) }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("only exposes reads and publishes multiple Posts per Run with request idempotency", async () => {
  type Inputs = inferRouterInputs<typeof router>;
  expectTypeOf<keyof Inputs["resources"]["post"]>().toEqualTypeOf<
    | "get"
    | "list"
    | "feed"
    | "media"
    | "byAlertEvent"
    | "unreadCounts"
    | "publishedRuns"
  >();
  const first = await publish(input("tool:first"));
  expect(await publish(input("tool:first"))).toEqual(first);
  expect(
    await publish({
      ...input("tool:first"),
      author: { providerId: "claude-code", kind: "provider" },
    }),
  ).toEqual(first);
  const second = await publish(input("tool:second"));
  expect(second.id).not.toBe(first.id);
  expect(second.origin).toEqual(origin);
  expect(second.author).toEqual({
    kind: "provider",
    providerId: "claude-code",
  });
  await expect(
    publish(
      input("tool:first", {
        content: [{ type: "text", text: "Changed" }],
      }),
    ),
  ).rejects.toBeInstanceOf(ResourceStateInvalid);
  expect((await caller.resources.post.list()).items).toHaveLength(2);
  expect(first).not.toHaveProperty("kind");
});

test("snapshots pure media, omits bytes from pages, and cascades only with Post removal", async () => {
  const base64 = Buffer.from("saved bytes").toString("base64");
  const mediaInput = (bytes: string) =>
    input("media", {
      content: [
        {
          type: "media",
          mime: "image/png",
          filename: "chart.png",
          bytes: Buffer.from(bytes),
          description: "Chart",
        },
      ],
    });
  const post = await publish(mediaInput("saved bytes"));
  expect(await publish(mediaInput("saved bytes"))).toEqual(post);
  await expect(publish(mediaInput("changed bytes"))).rejects.toBeInstanceOf(
    ResourceStateInvalid,
  );
  const block = post.content[0];
  if (block?.type !== "media") throw new Error("Expected saved media");
  expect(JSON.stringify(await caller.resources.post.list())).not.toContain(
    base64,
  );
  expect(await caller.resources.post.media({ id: block.mediaId })).toEqual({
    id: block.mediaId,
    mime: "image/png",
    filename: "chart.png",
    base64,
  });
  await runtime.runPromise(
    Transactor.run(postResource.transitions.remove(post.id)),
  );
  await expect(
    caller.resources.post.media({ id: block.mediaId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("optional Rule filtering precedes paging and resolves latest or deleted quotes", async () => {
  const original = await publish(
    input("event:first", {
      author: {
        kind: "rule",
        ruleId: AlertRuleId.make("alr_rule"),
        name: "Original Rule",
      },
      origin: {
        kind: "alert_event",
        ruleId: AlertRuleId.make("alr_rule"),
        eventId: AlertEventId.make("ale_event"),
        occurredAt: 123,
      },
    }),
  );
  const analysis = await publish(
    input("quoted", { quotedPostId: original.id }),
  );
  await publish(input("ordinary", { origin: { ...origin, alert: null } }));
  const first = await caller.resources.post.feed({
    limit: 1,
    ruleId: "alr_rule",
  });
  expect(first.items.map((item) => item.post.id)).toEqual([analysis.id]);
  expect(first.items[0]?.quotedPost?.id).toBe(original.id);
  expect(first.nextCursor).not.toBeNull();
  const next = await caller.resources.post.feed({
    limit: 1,
    cursor: first.nextCursor!,
    ruleId: "alr_rule",
  });
  expect(next.items.map((item) => item.post.id)).toEqual([original.id]);
  expect(next.nextCursor).toBeNull();
  const updated = {
    author: original.author,
    origin: original.origin,
    quotedPostId: null,
    content: [
      {
        type: "text" as const,
        text: "Updated original",
      },
    ],
  };
  await runtime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service;
      yield* db.transaction((tx) =>
        postStore.save(tx, original.id, { revision: 2, body: updated }),
      );
    }),
  );
  expect(
    (await caller.resources.post.feed({ limit: 1, ruleId: "alr_rule" }))
      .items[0]?.quotedPost?.content,
  ).toEqual(updated.content);
  await runtime.runPromise(
    Transactor.run(postResource.transitions.remove(original.id)),
  );
  const after = (
    await caller.resources.post.feed({ limit: 1, ruleId: "alr_rule" })
  ).items[0];
  expect(after?.post.quotedPostId).toBe(original.id);
  expect(after?.quotedPost).toBeNull();
  await expect(
    publish(
      input("missing quote", { quotedPostId: PostId.make("pst_missing") }),
    ),
  ).rejects.toMatchObject({ _tag: "Resource.NotFound" });
  expect((await caller.resources.post.list()).items).toHaveLength(2);
});

test("database rejects an empty post even if a writer bypasses the entity decoder", async () => {
  await expect(
    runtime.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service;
        yield* db.transaction((tx) =>
          tx.insert(posts).values({
            id: "pst_invalid",
            author: { kind: "provider", providerId: "codex" },
            origin: input("db").origin,
            content: [],
            quotedPostId: null,
            publicationKey: "db",
            publicationHash: "a".repeat(64),
          }),
        );
      }),
    ),
  ).rejects.toThrow();
});

test("reads retained originals, filters before paging, counts complete history, and finds every published Run", async () => {
  const original = await publish(
    input("event:ale_event", {
      author: {
        kind: "rule",
        ruleId: AlertRuleId.make("alr_rule"),
        name: "Rule snapshot",
      },
      origin: {
        kind: "alert_event",
        ruleId: AlertRuleId.make("alr_rule"),
        eventId: AlertEventId.make("ale_event"),
        occurredAt: 100,
      },
    }),
  );
  // Neither source Rule nor Event exists here: the published snapshot owns its lifetime.
  expect(
    await caller.resources.post.byAlertEvent({ eventId: "ale_event" }),
  ).toEqual(original);
  expect(
    (await caller.resources.post.feed({ search: "rule SNAPSHOT" })).items.map(
      ({ post }) => post.id,
    ),
  ).toEqual([original.id]);
  expect(
    await caller.resources.post.byAlertEvent({ eventId: "ale_missing" }),
  ).toBeNull();
  const note = await publish(
    input("note", {
      origin: { ...origin, runId: "agr_note_only" },
    }),
  );
  const analysis = await publish(
    input("analysis", { quotedPostId: original.id }),
  );
  await publish(
    input("other-rule", {
      origin: {
        ...origin,
        runId: "agr_other",
        alert: {
          eventId: AlertEventId.make("ale_other"),
          ruleId: AlertRuleId.make("alr_other"),
        },
      },
    }),
  );
  await publish(
    input("ordinary", {
      origin: { ...origin, runId: "agr_ordinary", alert: null },
    }),
  );

  const unread = { after: 0, excludeIds: [original.id, note.id] };
  const page = await caller.resources.post.feed({
    ruleId: "alr_rule",
    unread,
    limit: 1,
  });
  expect(page.items.map((item) => item.post.id)).toEqual([analysis.id]);
  expect(page.nextCursor).toBeNull();
  expect(page.items[0]?.quotedPost?.id).toBe(original.id);
  expect(
    (await caller.resources.post.feed({ ruleId: "alr_rule" })).items,
  ).toHaveLength(3);
  expect(
    await caller.resources.post.unreadCounts({
      ruleIds: ["alr_rule", "alr_other", "alr_missing"],
      ...unread,
    }),
  ).toEqual([
    { ruleId: "alr_rule", count: 1 },
    { ruleId: "alr_other", count: 1 },
    { ruleId: "alr_missing", count: 0 },
  ]);
  expect(
    await caller.resources.post.unreadCounts({
      ruleIds: ["alr_rule"],
      after: 0,
      excludeIds: [],
    }),
  ).toEqual([{ ruleId: "alr_rule", count: 3 }]);
  expect(
    await caller.resources.post.unreadCounts({
      ruleIds: ["alr_rule"],
      after: analysis.createdAt,
      excludeIds: [],
    }),
  ).toEqual([{ ruleId: "alr_rule", count: 0 }]);
  expect(
    (
      await caller.resources.post.feed({
        ruleId: "alr_rule",
        unread: { after: analysis.createdAt, excludeIds: [] },
      })
    ).items,
  ).toEqual([]);
  expect(
    (
      await caller.resources.post.publishedRuns({
        runIds: ["agr_one", "agr_note_only", "agr_missing"],
      })
    ).sort(),
  ).toEqual(["agr_note_only", "agr_one"]);
  expect(await caller.resources.post.publishedRuns({ runIds: [] })).toEqual([]);
});

test("replays trusted request hashes before mutable media resolution without exposing a public lookup", async () => {
  const key = "tool:request-before-import";
  const requestHash = "a".repeat(64);
  expect(
    await runtime.runPromise(
      Transactor.run(lookupPublishedPost(key, requestHash)),
    ),
  ).toBeNull();
  const post = await publish(
    input(key, {
      requestHash,
      content: [
        {
          type: "media",
          mime: "image/png",
          filename: "chart.png",
          description: "Chart",
          bytes: Buffer.from("snapshot"),
        },
      ],
    }),
  );
  expect(
    await runtime.runPromise(
      Transactor.run(lookupPublishedPost(key, requestHash)),
    ),
  ).toEqual(post);
  await expect(
    runtime.runPromise(
      Transactor.run(lookupPublishedPost(key, "b".repeat(64))),
    ),
  ).rejects.toBeInstanceOf(ResourceStateInvalid);
});

test("the desktop transport carries large read filters in POST bodies", async () => {
  const http = createHttpServer(createRequestHandler(runtime));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const transport = createTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  try {
    await publish(input("one"));
    expect(
      await transport.rpc.resources.post.unreadCounts.query(
        {
          ruleIds: ["alr_rule"],
          after: 0,
          excludeIds: Array.from({ length: 2500 }, (_, i) => `pst_absent_${i}`),
        },
        { context: { method: "POST" } },
      ),
    ).toEqual([{ ruleId: "alr_rule", count: 1 }]);
  } finally {
    transport.hose.disconnect();
    const closed = new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
    http.closeAllConnections();
    await closed;
  }
});
