// Purpose: Locks transcript Part, tool lifecycle, workflow, and plugin contracts.

import { Schema, Result } from "effect";

import { describe, expect, it } from "vitest";
import * as Part from "./part";
import { AgentPromptPartInput } from "./agent-prompt-input";

describe("transcript Part schemas", () => {
  it("uses the context kind to identify a dig-in target in transcripts and prompts", () => {
    const input = {
      type: "context",
      context: { kind: "dig_in", quoteText: "Selected text" },
    };
    const part = {
      ...input,
      id: "prt_quote",
      messageID: "msg_child",
    };
    expect(Schema.decodeUnknownSync(Part.Part)(part)).toEqual(part);
    expect(Schema.decodeUnknownSync(AgentPromptPartInput)(input)).toEqual(
      input,
    );
    for (const kind of ["dig_in", "claim"]) {
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(Part.Part)({ ...part, kind }),
        ),
      ).toBe(false);
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(AgentPromptPartInput)({ ...input, kind }),
        ),
      ).toBe(false);
    }
  });

  it("retains all tool lifecycle states and typed output forms", () => {
    expect(
      Schema.decodeUnknownSync(Part.ToolState)({
        status: "pending",
        input: {},
      }),
    ).toEqual({ status: "pending", input: {} });
    expect(
      Schema.decodeUnknownSync(Part.ToolState)({
        status: "running",
        input: {},
        time: { start: 1 },
      }).status,
    ).toBe("running");
    expect(
      Schema.decodeUnknownSync(Part.ToolState)({
        status: "error",
        input: ["invalid", null],
        error: "Invalid input",
        time: { start: 1, end: 2 },
      }).status,
    ).toBe("error");
    for (const status of ["pending", "running", "completed"]) {
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(Part.ToolState)({
            status,
            input: [],
            time: { start: 1, end: 2 },
          }),
        ),
      ).toBe(false);
    }
    for (const output of [
      { type: "text", value: "result" },
      { type: "json", value: { nested: [1, null, true] } },
      {
        type: "content",
        value: [
          { type: "text", text: "image" },
          { type: "media", mediaType: "image/png", data: "base64" },
        ],
      },
    ])
      expect(Schema.decodeUnknownSync(Part.ToolModelOutput)(output)).toEqual(
        output,
      );
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(Part.ToolState)({
          status: "awaiting_permission",
        }),
      ),
    ).toBe(false);
  });

  it("preserves input/plugin restrictions", () => {
    const chartInput = {
      type: "chart_explain",
      drawingId: "drw_1",
      resolution: "5m",
      session: "extended",
      adjustment: "split",
    };
    for (const input of [
      chartInput,
      { type: "alert_trigger", eventId: "event_1" },
      {
        type: "watchlist_semantic_cell",
        watchlistId: "watchlist_1",
        columnId: "column_1",
        nodeId: "node_1",
        row: {
          nodeId: "node_1",
          listingId: 1,
          symbol: "AAPL",
          name: "Apple",
          groupPath: ["Stocks"],
        },
      },
    ])
      expect(Schema.decodeUnknownSync(Part.PluginInput)(input)).toEqual(input);
    for (const input of [
      { ...chartInput, drawingId: "" },
      { ...chartInput, drawingId: "   " },
      { type: "chart_explain", spanId: "span_1" },
      { ...chartInput, spanId: "span_1" },
    ])
      expect(
        Result.isSuccess(Schema.decodeUnknownResult(Part.PluginInput)(input)),
      ).toBe(false);
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(Part.WorkflowPublicArgs)({ context: {} }),
      ),
    ).toBe(false);
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(Part.WorkflowId)("Invalid ID"),
      ),
    ).toBe(false);
  });

  it.each(["resolution", "session", "adjustment"])(
    "requires a valid Chart Explain %s without defaulting",
    (field) => {
      for (const value of [undefined, null, "invalid"]) {
        expect(
          Result.isSuccess(
            Schema.decodeUnknownResult(Part.PluginInput)({
              type: "chart_explain",
              drawingId: "drw_1",
              resolution: "5m",
              session: "extended",
              adjustment: "split",
              [field]: value,
            }),
          ),
        ).toBe(false);
      }
    },
  );

  it("keeps child session relationships across tool states without display data", () => {
    const states: Part.ToolState[] = [
      { status: "pending", input: {} },
      {
        status: "running",
        input: {},
        title: "Researching",
        time: { start: 1 },
      },
      {
        status: "completed",
        input: {},
        title: "Researched",
        output: { type: "text", value: "Model-facing result" },
        metadata: {},
        time: { start: 1, end: 2 },
      },
      {
        status: "error",
        input: {},
        error: "Interrupted",
        time: { start: 1, end: 2 },
      },
    ];
    for (const state of states) {
      const part = {
        id: "prt_task",
        messageID: "msg_parent",
        type: "tool",
        childSessionIds: [],
        tool: "task",
        callID: "call_task",
        state,
      };
      expect(Schema.decodeUnknownSync(Part.ToolPart)(part)).toEqual(part);
      const linked = { ...part, childSessionIds: ["ses_child", "ses_other"] };
      expect(Schema.decodeUnknownSync(Part.Part)(linked)).toEqual(linked);
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(Part.ToolPart)({
            ...part,
            childSessionIds: ["ses_child", "ses_child"],
          }),
        ),
      ).toBe(false);
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(Part.ToolPart)({
            ...part,
            childSessionIds: [""],
          }),
        ),
      ).toBe(false);
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(Part.ToolPart)({
            ...part,
            displayData: { overview: { request: "Researching" } },
          }),
        ),
      ).toBe(false);
    }
  });
});
