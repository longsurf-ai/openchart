// Purpose: Publishes mixed Post content with trusted invocation attribution and durable Workspace media snapshots.
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { Effect, Predicate, Schema } from "effect";
import { Tool } from "@openchart/server/agent/tool/tool";
import { readRun } from "@openchart/server/agent/run/store";
import { ID as AgentRunId } from "@openchart/server/agent/run/run";
import { Session } from "@openchart/server/agent/session";
import { SessionId } from "@openchart/server/agent/contracts/session";
import { Workflow } from "@openchart/server/agent/workflow";
import { Transactor } from "@openchart/server/lib/resource";
import { ResourceName } from "@openchart/server/resources/catalog";
import {
  publishPost,
  lookupPublishedPost,
  type PostPublication,
  PostId,
} from "@openchart/server/resources/post";
import { PostText } from "@openchart/server/resources/post/schema";
import { POST_CHARACTER_LIMIT } from "@openchart/server/resources/post/entity";
import { workspaceResource } from "@openchart/server/resources/workspace";
import { WorkspaceId } from "@openchart/server/resources/workspace/entity";
import {
  MediaPath,
  WORKSPACE_MEDIA_MAX_BYTES,
} from "@openchart/server/workspace/contract";
import { Workspaces } from "@openchart/server/workspace/workspace";
import {
  alertIntent,
  alertPostForIntent,
} from "@openchart/server/trigger/post-context";
import { ResourceArgumentsError } from "./errors";
import { ask, parse, result, select } from "./resource-shared";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
/** Author and provenance are unavailable as model inputs; media paths are relative to this invocation's Workspace. */
export const Parameters = Schema.Struct({
  content: Schema.Array(
    Schema.Union([
      PostText,
      Schema.Struct({
        type: Schema.Literal("media"),
        path: MediaPath,
        description: Schema.String,
      }).annotate(strict),
      Schema.Struct({
        type: Schema.Literal("resource"),
        resource: ResourceName,
        id: Schema.NonEmptyString,
      }).annotate(strict),
    ]),
  ).check(Schema.isMinLength(1)),
  quotedPostId: Schema.optionalKey(PostId),
}).annotate(strict);

/** Publishes one saved Post through its owner; same-call retries are idempotent and different calls may publish independently.
 * @example const tool = yield* Tool.init(yield* PublishPostTool); yield* tool.execute({content:[{type:"text",text:"The move remains unconfirmed."}]}, context);
 */
export const PublishPostTool = Tool.define(
  "publish_post",
  Effect.succeed({
    description: `Publish a Feed Post. Max ${POST_CHARACTER_LIMIT} Unicode characters across text and media descriptions, including Markdown syntax and whitespace. Media paths are relative to the current Workspace; bytes are saved with the Post. Author/origin are automatic. Alert Posts quote the original. Success means published; do not repeat.`,
    parameters: Parameters,
    execute: (input: typeof Parameters.Type, context: Tool.Context) =>
      result(
        "Publish post",
        Effect.gen(function* () {
          yield* ask(context, "publish_post", ["post"], {});
          const publicationKey = `tool:${context.sessionID}:${context.messageID}:${context.callID}`;
          // Resolve mutable files only after checking the original, validated tool request.
          const requestHash = createHash("sha256")
            .update(
              JSON.stringify(input, (_key, value: unknown) =>
                Predicate.isObject(value)
                  ? Object.fromEntries(
                      Object.entries(value).sort(([a], [b]) =>
                        a.localeCompare(b),
                      ),
                    )
                  : value,
              ),
            )
            .digest("hex");
          const existing = yield* Transactor.run(
            lookupPublishedPost(publicationKey, requestHash),
          );
          if (existing) return { resource: "post", entity: existing };
          const run = yield* readRun(
            yield* Schema.decodeUnknownEffect(AgentRunId)(context.rootRunID),
          );
          if (!run || run.status !== "running")
            return yield* new ResourceArgumentsError({
              detail: "Publishing requires an active Agent execution.",
            });
          const sessions = yield* Session.Service;
          const message = yield* sessions.getMessage({
            sessionID: context.sessionID,
            messageID: context.messageID,
          });
          if (message?.info.role !== "assistant")
            return yield* new ResourceArgumentsError({
              detail: "Publishing requires the current Assistant message.",
            });
          const original = yield* alertPostForIntent(run.sessionIntentID);
          if (alertIntent(run.sessionIntentID) && !original)
            return yield* new ResourceArgumentsError({
              detail: "The original Alert Post is no longer available.",
            });
          const alert =
            original?.origin.kind === "alert_event"
              ? {
                  eventId: original.origin.eventId,
                  ruleId: original.origin.ruleId,
                }
              : null;
          if (
            alert &&
            input.quotedPostId &&
            input.quotedPostId !== original?.id
          )
            return yield* new ResourceArgumentsError({
              detail:
                "A Post from an Alert execution must quote its original Rule Post.",
            });
          const { parentPrompt } = yield* Workflow.Service;
          let mediaBytes = 0;
          const content = yield* Effect.forEach(input.content, (block) =>
            Effect.gen(function* () {
              if (block.type === "resource") {
                const definition = select(block.resource);
                const id = yield* parse(definition.id, block.id);
                yield* Transactor.run(definition.transitions.get(id));
                return block;
              }
              if (block.type !== "media") return block;
              const workspaceId = parentPrompt.workspaceId
                ? WorkspaceId.make(parentPrompt.workspaceId)
                : yield* Transactor.run(
                    workspaceResource.transitions.getDefault(),
                  );
              const workspaces = yield* Workspaces;
              const workspace = yield* workspaces.open(workspaceId);
              const file = yield* workspace.read(block.path);
              const bytes = Buffer.from(file.base64, "base64");
              if (bytes.length === 0)
                return yield* new ResourceArgumentsError({
                  detail: "Post attachments must not be empty.",
                });
              mediaBytes += bytes.length;
              if (mediaBytes > WORKSPACE_MEDIA_MAX_BYTES)
                return yield* new ResourceArgumentsError({
                  detail: "Post attachments must total at most 32 MiB.",
                });
              return {
                type: "media" as const,
                mime: file.mediaType,
                filename: basename(block.path),
                bytes,
                description: block.description,
              };
            }),
          );
          const publication: PostPublication = {
            publicationKey,
            requestHash,
            author: { kind: "provider", providerId: message.info.providerID },
            origin: {
              kind: "agent_run",
              runId: run.id,
              sessionId: SessionId.make(context.sessionID),
              alert,
            },
            content,
            quotedPostId: input.quotedPostId ?? original?.id ?? null,
          };
          const entity = yield* Transactor.run(publishPost(publication));
          return { resource: "post", entity };
        }),
      ),
  }),
);
