import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@openchart/app/lib/agent/session-store";
import type { SessionState } from "@openchart/app/lib/agent/client";
import { selectSessionProgress } from "@openchart/app/lib/agent/session-progress";

function snapshot(
  status: SessionState["runs"][number]["status"],
): SessionSnapshot {
  return {
    history: { hasMore: false, loading: false, error: undefined },
    loading: false,
    error: undefined,
    subagents: {},
    messages: [
      { id: "old", role: "assistant", content: "Previous answer" },
      { id: "user", role: "user", content: "Explain" },
      { id: "thinking", role: "reasoning", content: "Checking the selection" },
      { id: "reply", role: "assistant", content: "First live line" },
    ],
    state: {
      session: {
        id: "ses_test" as SessionState["session"]["id"],
        title: "Test",
        kind: "chat",
        bindingId: "asb_test",
        parentId: null,
        anchors: null,
        compactingAt: null,
        archivedAt: null,
        lastReadRunId: null,
        createdAt: 1000,
        updatedAt: 1000,
      },
      messageInfo: {},
      history: { nextCursor: null },
      questions: [],
      permissions: [],
      runs: [
        {
          id: "agr_test" as SessionState["runs"][number]["id"],
          sessionID: "ses_test",
          sessionIntentID: "intent",
          status,
          createdAt: 1000,
          startedAt: status === "queued" ? null : 1100,
          finishedAt: null,
          queuePosition: null,
        },
      ],
    },
  };
}

describe("session progress", () => {
  it("derives current-turn progress without changing the shared snapshot", () => {
    const current = snapshot("running");
    expect(selectSessionProgress(current)).toEqual({
      status: "running",
      startedAt: 1100,
      lines: ["Checking the selection", "First live line"],
    });
    expect(
      selectSessionProgress({
        ...current,
        messages: [
          ...current.messages,
          { id: "delta", role: "assistant", content: "Second live line" },
        ],
      })?.lines.at(-1),
    ).toBe("Second live line");
    expect(current).toEqual(snapshot("running"));
  });

  it.each(["completed", "failed", "stop"] as const)(
    "clears progress when the Run becomes %s",
    (status) => {
      expect(selectSessionProgress(snapshot(status))).toBeUndefined();
    },
  );

  it("exposes queued/running state before output and ignores prior-run content", () => {
    const current = snapshot("queued");
    current.messages = [
      {
        id: "old",
        role: "assistant",
        content: "Old answer",
        metadata: { openchart: { createdAt: 1 } },
      },
    ];
    expect(selectSessionProgress(current)).toEqual({
      status: "queued",
      startedAt: 1000,
      lines: [],
    });
    expect(
      selectSessionProgress({
        ...snapshot("running"),
        messages: current.messages,
      }),
    ).toEqual({
      status: "running",
      startedAt: 1100,
      lines: [],
    });
  });

  it("leaves line limits to consumers and includes tool progress", () => {
    const current = snapshot("running");
    const lines = Array.from({ length: 8 }, (_, index) => `Line ${index}`);
    current.messages.push({
      id: "tools",
      role: "assistant",
      content: lines.join("\n"),
      toolCalls: [
        {
          id: "call_test",
          type: "function",
          function: { name: "resource_read", arguments: "{}" },
        },
      ],
    });
    expect(selectSessionProgress(current)?.lines).toEqual([
      "Checking the selection",
      "First live line",
      ...lines,
      "Using resource_read…",
    ]);
  });

  it("has no progress before the Session state is observed", () => {
    const current = snapshot("running");
    current.state = undefined;
    expect(selectSessionProgress(current)).toBeUndefined();
  });
});
