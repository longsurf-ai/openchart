// Purpose: Markdown research replies yield compact previews without changing their transcript.
import { expect, test } from "vitest";
import { latestSemanticAnswer } from "../utils/semantic-answer";

const reply = (content: string, id = "answer") => ({
  id,
  role: "assistant" as const,
  content,
});

test.each([
  ["# Strong pricing power\n\nFull explanation.", "Strong pricing power"],
  ["\n  # 08.50\r\n\r\nA numeric answer.", "08.50"],
  [
    "# Insufficient evidence\n\nThe filings do not disclose this.",
    "Insufficient evidence",
  ],
  [
    "# **Strong** [pricing](https://example.com) ###\n\nDetails.",
    "Strong pricing",
  ],
  ["Growth is 8.5%. Margins are improving.", "Growth is 8.5%."],
  [
    "**Demand** remains strong. [More](https://example.com).",
    "Demand remains strong.",
  ],
  ["增长稳健。利润率改善。", "增长稳健。"],
  [
    "## Assessment\n\nPricing remains strong. More detail.",
    "Pricing remains strong.",
  ],
  [
    "```ts\nconst score = 8;\n```\n\nEvidence is mixed. More detail.",
    "Evidence is mixed.",
  ],
  ["```ts\nconst score = 8;\n```", undefined],
  ["\n  \n", undefined],
])("previews %j", (content, expected) => {
  const message = reply(content);
  expect(latestSemanticAnswer([message])).toBe(expected);
  expect(message.content).toBe(content);
});

test("keeps a research heading through unheaded follow-up chat and accepts an updated heading", () => {
  const messages = [
    { id: "q", role: "user" as const, content: "Give a score." },
    reply("# 8/10\n\nEvidence.", "research"),
    { id: "followup", role: "user" as const, content: "Thanks" },
    reply("You are welcome.", "chat"),
  ];
  expect(latestSemanticAnswer(messages)).toBe("8/10");
  expect(
    latestSemanticAnswer([...messages, reply("# 9/10\n\nNew evidence.")]),
  ).toBe("9/10");
});

test("uses the latest prose when no reply has a summary heading, ignoring tool and nested subagent output", () => {
  expect(
    latestSemanticAnswer([
      reply("Earlier answer. Details.", "old"),
      reply("Updated answer. Details."),
      {
        id: "tool",
        role: "tool",
        toolCallId: "call",
        content: "# Tool output",
      },
      { ...reply("# Nested research", "child"), subagentRunId: "subagent" },
    ]),
  ).toBe("Updated answer.");
  expect(latestSemanticAnswer([])).toBeUndefined();
});
