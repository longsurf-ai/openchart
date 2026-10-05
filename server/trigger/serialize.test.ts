// Purpose: Verifies escaped templates, explicit source identity, token precedence, and prompt preservation.

import type { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { AlertEventEntity } from "@openchart/server/resources/alert-event";
import { Schema } from "effect";
import { expect, test } from "vitest";

import { alertTokens, renderPrompt, renderTemplate } from "./serialize";

const event = (data: Schema.JsonObject) =>
  Schema.decodeUnknownSync(AlertEventEntity)({
    id: "ale_1",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    ruleId: "alr_1",
    condition: "above",
    time: Date.parse("2026-09-21T13:30:00.000Z"),
    detail: { title: "Above", message: "AAPL crossed 200", data },
  });

test("renders fixed and source fields; unknown tokens and other braces stay literal", () => {
  const tokens = alertTokens(
    event({
      symbol: "AAPL",
      provider: "yfinance",
      resolution: "1m",
      parameters: { threshold: 200, strict: true },
      values: { close: 201.5 },
    }),
    "AAPL breakout",
  );
  expect(renderTemplate("{symbol} has exceeded {threshold}", tokens)).toBe(
    "AAPL has exceeded 200",
  );
  expect(
    renderTemplate(
      "{rule}|{provider}|{resolution}|{condition}|{time}|{title}|{message}|{strict}|{close}",
      tokens,
    ),
  ).toBe(
    "AAPL breakout|yfinance|1m|above|2026-09-21T13:30:00.000Z|Above|AAPL crossed 200|true|201.5",
  );
  expect(
    renderTemplate(
      "{unknown} {toString} {} {{symbol}} { symbol } {a-b}",
      tokens,
    ),
  ).toBe("{unknown} {toString} {} {AAPL} { symbol } {a-b}");
  expect(
    renderTemplate(String.raw`\{symbol\} \\{symbol} C:\path {symbol}`, tokens),
  ).toBe(String.raw`{symbol} \AAPL C:\path AAPL`);
});

test("fixed fields win over explicit data, parameters, then values; nested inputs never imply identity", () => {
  const tokens = alertTokens(
    event({
      symbol: "MSFT",
      title: "spoof",
      threshold: 200,
      parameters: { symbol: "PARAMETER", threshold: 1, window: 5, object: {} },
      values: { symbol: 1, threshold: 2, window: 3, time: 3 },
    }),
    "Rule",
  );
  expect(
    renderTemplate(
      "{symbol}|{title}|{threshold}|{window}|{time}|{object}",
      tokens,
    ),
  ).toBe("MSFT|Above|200|5|2026-09-21T13:30:00.000Z|{object}");
  const generic = alertTokens(
    event({
      inputs: { listing: { symbol: "AAPL" } },
      count: 50,
      missing: null,
      array: [1],
    }),
    "Files",
  );
  expect(renderTemplate("{symbol}|{count}|{missing}|{array}", generic)).toBe(
    "{symbol}|50|{missing}|{array}",
  );
});

test("renders only prompt text and leaves all other parts and fields unchanged", () => {
  const prompt: AgentPromptInput = {
    agent: "analyst",
    workspaceId: "{symbol}",
    model: { providerID: "codex", modelID: "tier1" },
    parts: [
      {
        type: "text",
        text: "Review {symbol}; literal \\{symbol\\}",
        id: "prt_{symbol}",
      },
      {
        type: "file",
        mime: "text/plain",
        url: "file:///{symbol}.txt",
        filename: "{symbol}.txt",
      },
    ],
  };
  const rendered = renderPrompt(prompt, new Map([["symbol", "MSFT"]]));
  expect(rendered).toEqual({
    ...prompt,
    parts: [
      { ...prompt.parts[0], text: "Review MSFT; literal {symbol}" },
      prompt.parts[1],
    ],
  });
  expect(rendered.parts[1]).toBe(prompt.parts[1]);
  expect(rendered.parts).toHaveLength(prompt.parts.length);
});
