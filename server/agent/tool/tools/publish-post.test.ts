// Purpose: Exercises publication through trusted tool context, accepted Runs, persisted messages, and Workspace files.
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ProviderId } from "@openchart/market";
import type { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { AgentRunStore } from "@openchart/server/agent/run/store";
import { Session } from "@openchart/server/agent/session";
import { Tool } from "@openchart/server/agent/tool/tool";
import { InvalidArgumentsError } from "@openchart/server/agent/tool/errors";
import { Workflow } from "@openchart/server/agent/workflow";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { Transactor } from "@openchart/server/lib/resource";
import { alertEventResource } from "@openchart/server/resources/alert-event";
import {
  alertRuleResource,
  AlertableDefinition,
} from "@openchart/server/resources/alert-rule";
import {
  postResource,
  PostEntity,
  publishPost,
} from "@openchart/server/resources/post";
import { workspaceResource } from "@openchart/server/resources/workspace";
import { makeRuntime } from "@openchart/server/runtime";
import { Workspaces } from "@openchart/server/workspace/workspace";
import * as Tea from "@openchart/tea";
import {
  RelPath,
  WORKSPACE_MEDIA_MAX_BYTES,
} from "@openchart/server/workspace/contract";
import { PublishPostTool } from "./publish-post";
import { assistant, user } from "./transcript.test-utils";

let runtime: ReturnType<typeof makeRuntime>;
beforeEach(() => {
  runtime = makeRuntime({ home: temporaryHome(), databasePath: ":memory:" });
});
afterEach(async () => {
  await runtime.dispose();
  vi.restoreAllMocks();
});
const prompt: AgentPromptInput = {
  agent: "analyst",
  model: { providerID: "codex", modelID: "tier1" },
  parts: [{ type: "text", text: "Review this move." }],
};
const textPost = {
  content: [
    {
      type: "text",
      text: "Volume confirms participation, not direction.",
    },
  ],
};

async function invocation(intent = "chat:publish-test") {
  const prepared = await runtime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service;
      const runs = yield* AgentRunStore.Service;
      const root = yield* sessions.create({ title: "Root Codex" });
      const child = yield* sessions.create({
        parentId: root.id,
        kind: "delegate",
        title: "Child Claude",
      });
      const workspaceId = yield* Transactor.run(
        workspaceResource.transitions.getDefault(),
      );
      const workspace = yield* Transactor.run(
        workspaceResource.transitions.get(workspaceId),
      );
      const accepted = yield* runs.enqueue({
        sessionID: root.id,
        sessionIntentID: intent,
        input: { ...prompt, workspaceId },
      });
      const claimed = yield* runs.claim(root.id);
      expect(claimed?.id).toBe(accepted.id);
      const request = user("msg_publish_user", [], child.id);
      if (request.info.role !== "user")
        throw new Error("Expected User fixture");
      request.info.model.providerID = "claude-code";
      yield* sessions.createMessage(request);
      const message = assistant("msg_publish_assistant", [], child.id);
      if (message.info.role !== "assistant")
        throw new Error("Expected Assistant fixture");
      message.info.providerID = "claude-code";
      message.info.triggeringUserMessageID = request.info.id;
      yield* sessions.createMessage(message);
      return { run: accepted, root, child, workspace, message };
    }),
  );
  const ask = vi.fn<Tool.Context["ask"]>(() => Effect.void);
  const context: Tool.Context = {
    rootRunID: prepared.run.id,
    sessionID: prepared.child.id,
    messageID: prepared.message.info.id,
    callID: "call_1",
    agent: "analyst",
    messages: [],
    metadata: () => Effect.void,
    ask,
  };
  const workflow = Workflow.Service.of({
    settings: { concurrency: 5 },
    parentPrompt: {
      ...prompt,
      workspaceId: prepared.workspace.id,
      model: { providerID: "claude-code", modelID: "tier1" },
    },
    agent: () => Effect.die("This test never invokes another Agent"),
  });
  const invoke = (input: Schema.JsonObject, callID = "call_1") =>
    runtime.runPromise(
      Effect.gen(function* () {
        const sessions = yield* Session.Service;
        const message = yield* sessions.getMessage({
          sessionID: context.sessionID,
          messageID: context.messageID,
        });
        if (
          !message?.parts.some(
            (part) => part.type === "tool" && part.callID === callID,
          )
        ) {
          yield* sessions.createPart({
            id: `prt_${callID}`,
            messageID: context.messageID,
            type: "tool",
            tool: "publish_post",
            callID,
            childSessionIds: [],
            state: { status: "running", input, time: { start: 1 } },
          });
        }
        const tool = yield* Tool.init(yield* PublishPostTool);
        return yield* tool.execute(input, { ...context, callID });
      }).pipe(Effect.provideService(Workflow.Service, workflow)),
    );
  return { ...prepared, invoke, ask };
}

function output(result: Tool.ExecuteResult) {
  if (result.output.type !== "text")
    throw new Error("Expected Resource JSON result");
  return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject))(
    result.output.value,
  );
}
function published(result: Tool.ExecuteResult) {
  const value = output(result);
  expect(value.status).toBe("ok");
  return Schema.decodeUnknownSync(PostEntity)(value.entity);
}

test("uses the publishing child provider and Session, while retaining root Run provenance and request idempotency", async () => {
  const fixture = await invocation();
  const first = published(await fixture.invoke(textPost));
  expect(first).not.toHaveProperty("kind");
  expect(first.author).toEqual({ kind: "provider", providerId: "claude-code" });
  expect(first.origin).toEqual({
    kind: "agent_run",
    runId: fixture.run.id,
    sessionId: fixture.child.id,
    alert: null,
  });
  expect(fixture.run.input.model.providerID).toBe("codex");
  expect(published(await fixture.invoke(textPost)).id).toBe(first.id);
  const second = published(await fixture.invoke(textPost, "call_2"));
  expect(second.id).not.toBe(first.id);
  expect(
    output(
      await fixture.invoke({
        ...textPost,
        content: [{ type: "text", text: "Changed" }],
      }),
    ),
  ).toMatchObject({
    status: "rejected",
    message: expect.stringContaining(
      "Publication key was already used for different content",
    ),
  });
  const spoofs: Schema.JsonObject[] = [
    { author: { kind: "provider", providerId: "codex" } },
    { origin: { kind: "agent_run", runId: "agr_forged" } },
    { requestHash: "a".repeat(64) },
    { kind: "note" },
    { kind: "analysis" },
    { kind: "alert_event" },
    { extra: true },
    { content: [] },
    { content: [{ type: "text", text: "  " }] },
    { content: [{ type: "media", path: "source.md", description: "Source" }] },
  ];
  for (const spoof of spoofs) {
    await expect(
      fixture.invoke({ ...textPost, ...spoof }, "call_spoof"),
    ).rejects.toBeInstanceOf(InvalidArgumentsError);
  }
  expect(
    (await runtime.runPromise(Transactor.run(postResource.transitions.list())))
      .items,
  ).toHaveLength(2);
  expect(fixture.ask).toHaveBeenCalledWith(
    expect.objectContaining({ permission: "publish_post", patterns: ["post"] }),
  );
});

test("imports durable media and automatically quotes the retained original after Rule/Event deletion", async () => {
  const saved = await runtime.runPromise(
    Effect.gen(function* () {
      const rule = yield* Transactor.run(
        alertRuleResource.transitions.create({
          name: "Source rule",
          enabled: false,
          repeat: true,
          alertable: Schema.decodeUnknownSync(AlertableDefinition)({
            kind: "tea",
            source: "close",
            config: Schema.encodeSync(Tea.NodeConfig)({
              ...Tea.barsInputs({
                provider: ProviderId.make("yfinance"),
                listing: { symbol: "AAPL", currency: "USD" },
                resolution: "1m",
                session: "regular",
                adjustment: "raw",
              }),
              parameters: {},
              requests: {},
            }),
          }),
        }),
      );
      const event = yield* Transactor.run(
        alertEventResource.transitions.create({
          ruleId: rule.id,
          condition: "crossing",
          time: 100,
          detail: { title: "Crossed", message: "AAPL above 200", data: {} },
        }),
      );
      const original = yield* Transactor.run(
        publishPost({
          publicationKey: `event:${event.id}`,
          author: { kind: "rule", ruleId: rule.id, name: rule.name },
          origin: {
            kind: "alert_event",
            eventId: event.id,
            ruleId: rule.id,
            occurredAt: event.time,
          },
          content: [{ type: "text", text: "AAPL above 200" }],
          quotedPostId: null,
        }),
      );
      yield* Transactor.run(alertRuleResource.transitions.remove(rule.id));
      return { rule, event, original };
    }),
  );
  const fixture = await invocation(`trigger:trg_removed:${saved.event.id}`);
  const related = published(await fixture.invoke(textPost, "call_text"));
  expect(related.quotedPostId).toBe(saved.original.id);
  expect(
    output(
      await fixture.invoke(
        { ...textPost, quotedPostId: related.id },
        "call_wrong_quote",
      ),
    ),
  ).toMatchObject({
    status: "rejected",
    message:
      "A Post from an Alert execution must quote its original Rule Post.",
  });
  const file = join(fixture.workspace.root, "chart.png");
  const bytes = Buffer.from("immutable generated chart bytes");
  await writeFile(file, bytes);
  const mediaInput = {
    content: [
      { type: "media", path: "chart.png", description: "Generated chart" },
    ],
  };
  const post = published(await fixture.invoke(mediaInput));
  expect(post.quotedPostId).toBe(saved.original.id);
  expect(post.origin).toMatchObject({
    alert: { eventId: saved.event.id, ruleId: saved.rule.id },
  });
  await unlink(file);
  await runtime.runPromise(
    Effect.flatMap(AgentRunStore.Service, (runs) =>
      runs.complete(fixture.run.id),
    ),
  );
  expect(published(await fixture.invoke(mediaInput))).toEqual(post);
  const block = post.content[0];
  if (block?.type !== "media") throw new Error("Expected imported media");
  const media = await runtime.runPromise(
    Transactor.run(postResource.transitions.media({ id: block.mediaId })),
  );
  expect(media).toMatchObject({
    mime: "image/png",
    filename: "chart.png",
    base64: bytes.toString("base64"),
  });
  const feed = await runtime.runPromise(
    Transactor.run(postResource.transitions.feed({})),
  );
  expect(
    feed.items.find((item) => item.post.id === post.id)?.quotedPost,
  ).toEqual(saved.original);
});

test("enforces the Post entity's 350-character invariant without persisting partial content", async () => {
  const fixture = await invocation();
  await writeFile(join(fixture.workspace.root, "chart.png"), "chart bytes");
  const oversized: Schema.JsonObject[] = [
    { content: [{ type: "text", text: "a".repeat(351) }] },
    {
      content: [
        { type: "text", text: "€".repeat(200) },
        { type: "text", text: "😀".repeat(151) },
      ],
    },
    {
      content: [
        { type: "text", text: "a".repeat(350) },
        { type: "media", path: "chart.png", description: "€" },
      ],
    },
    {
      content: [
        { type: "media", path: "chart.png", description: "€".repeat(351) },
      ],
    },
  ];
  for (const input of oversized) {
    expect(output(await fixture.invoke(input))).toMatchObject({
      status: "rejected",
      code: "resource.state_invalid",
      message: expect.stringContaining("at most 350 Unicode characters"),
      issues: [{ code: "post.character_limit", path: "/content" }],
    });
  }
  expect(
    (await runtime.runPromise(Transactor.run(postResource.transitions.list())))
      .items,
  ).toEqual([]);

  const text = `${"€".repeat(100)}${"😀".repeat(100)}${"a".repeat(144)}** \n**`;
  expect(Array.from(text)).toHaveLength(350);
  const first = published(
    await fixture.invoke({ content: [{ type: "text", text }] }, "call_limit"),
  );
  expect(first.content).toEqual([{ type: "text", text }]);
  const quoted = published(
    await fixture.invoke(
      { content: [{ type: "text", text }], quotedPostId: first.id },
      "call_quote_limit",
    ),
  );
  expect(quoted.quotedPostId).toBe(first.id);
});

test("imports a full 32 MiB Workspace video and rejects empty media before publication", async () => {
  const fixture = await invocation();
  await writeFile(join(fixture.workspace.root, "empty.png"), "");
  expect(
    output(
      await fixture.invoke({
        content: [{ type: "media", path: "empty.png", description: "Empty" }],
      }),
    ),
  ).toMatchObject({
    status: "rejected",
    message: "Post attachments must not be empty.",
  });
  expect(
    (await runtime.runPromise(Transactor.run(postResource.transitions.list())))
      .items,
  ).toEqual([]);

  const bytes = Buffer.alloc(WORKSPACE_MEDIA_MAX_BYTES, 0x80);
  await writeFile(join(fixture.workspace.root, "video.webm"), bytes);
  const post = published(
    await fixture.invoke(
      {
        content: [{ type: "media", path: "video.webm", description: "Video" }],
      },
      "call_video",
    ),
  );
  const block = post.content[0];
  if (block?.type !== "media") throw new Error("Expected imported media");
  const media = await runtime.runPromise(
    Transactor.run(postResource.transitions.media({ id: block.mediaId })),
  );
  expect(media.mime).toBe("video/webm");
  expect(media.filename).toBe("video.webm");
  expect(media.base64).toBe(bytes.toString("base64"));
});

test("rejects aggregate attachments above 32 MiB without persisting a partial Post", async () => {
  const fixture = await invocation();
  const workspace = await runtime.runPromise(
    Effect.flatMap(Workspaces, (workspaces) =>
      workspaces.open(fixture.workspace.id),
    ),
  );
  const base64 = Buffer.alloc(17 * 1024 * 1024).toString("base64");
  const read = vi.spyOn(workspace, "read").mockImplementation(() =>
    Effect.succeed({
      entry: {
        path: Schema.decodeUnknownSync(RelPath)("fake.png"),
        hash: "a".repeat(64),
      },
      mediaType: "image/png",
      readOnly: false,
      base64,
    }),
  );
  const result = output(
    await fixture.invoke({
      content: [
        { type: "media", path: "first.png", description: "First" },
        { type: "media", path: "second.png", description: "Second" },
      ],
    }),
  );
  expect(result).toMatchObject({
    status: "rejected",
    message: "Post attachments must total at most 32 MiB.",
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(
    (await runtime.runPromise(Transactor.run(postResource.transitions.list())))
      .items,
  ).toEqual([]);
});
