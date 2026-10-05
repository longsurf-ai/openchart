// Purpose: Validates Markdown-only text and the entity-owned Post character limit.
import { Schema } from "effect";
import { expect, test } from "vitest";
import { PostText } from "./schema";
import { PostEntity } from "./entity";
import { deriveWriteShape } from "@openchart/server/lib/resource/write-schema";

test("text has no format selector and rejects legacy formats", () => {
  const decode = Schema.decodeUnknownSync(PostText);
  const input = { type: "text", text: "**Analysis**" };
  expect(decode(input)).toEqual(input);
  for (const format of ["plain", "markdown"]) {
    expect(() => decode({ ...input, format })).toThrow();
  }
});

test("the entity and its derived write schema enforce the same combined character limit", () => {
  const entity = {
    id: "pst_limit",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    author: { kind: "provider", providerId: "codex" },
    origin: {
      kind: "agent_run",
      runId: "agr_limit",
      sessionId: "ses_limit",
      alert: null,
    },
    quotedPostId: null,
    content: [
      { type: "text", text: "€".repeat(200) },
      { type: "media", mediaId: "pmd_limit", description: "😀".repeat(150) },
      { type: "resource", resource: "chart", id: "chr_limit" },
    ],
  };
  for (const schema of [PostEntity, deriveWriteShape(PostEntity).schema]) {
    const decode = Schema.decodeUnknownSync(schema);
    expect(() => decode(entity)).not.toThrow();
    expect(() =>
      decode({
        ...entity,
        content: [...entity.content, { type: "text", text: "!" }],
      }),
    ).toThrow("at most 350 Unicode characters");
  }
});
