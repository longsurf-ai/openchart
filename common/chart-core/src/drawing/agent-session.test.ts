import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { Drawing } from "./types";
import { agentSessionBands } from "@openchart/chart-core/drawing/kinds/agent-session";

function selection(id: string, from: number, to: number) {
  return Schema.decodeUnknownSync(Drawing.AgentSessionItem)({
    type: "agent_session",
    anchors: [],
    id,
    range: { from, to },
    style: { lineColor: "#00ffff" },
  });
}

const progress = {
  a: { startedAtMs: 10, progressLog: [{ text: "Reading sources", atMs: 10 }] },
  b: { startedAtMs: 20, progressLog: [{ text: "Searching", atMs: 20 }] },
  c: { startedAtMs: 30, progressLog: [{ text: "Checking filings", atMs: 30 }] },
};

describe("agentSessionBands", () => {
  it("merges unsorted, chained and nested overlaps without changing inputs", () => {
    const items = [
      selection("c", 6000, 9000),
      selection("a", 1000, 4000),
      selection("b", 3000, 7000),
    ];
    const original = JSON.stringify({ items, progress });
    expect(agentSessionBands(items, progress)).toMatchObject([
      {
        tStart: 1,
        tEnd: 9,
        startedAtMs: 10,
        progressLog: [{ text: "3 agents running", atMs: 10 }],
      },
    ]);
    expect(
      agentSessionBands(
        [selection("a", 1000, 9000), selection("b", 3000, 4000)],
        progress,
      ),
    ).toMatchObject([
      { tStart: 1, tEnd: 9, progressLog: [{ text: "2 agents running" }] },
    ]);
    expect(JSON.stringify({ items, progress })).toBe(original);
  });

  it("splits when the bridging session finishes and resumes each remaining stream", () => {
    const items = [
      selection("a", 1000, 4000),
      selection("b", 3000, 7000),
      selection("c", 6000, 9000),
    ];
    const live = { a: progress.a, c: progress.c };
    expect(agentSessionBands(items, live)).toMatchObject([
      { tStart: 1, tEnd: 4, progressLog: progress.a.progressLog },
      { tStart: 6, tEnd: 9, progressLog: progress.c.progressLog },
    ]);
    const update = {
      ...progress.c,
      progressLog: [{ text: "Found the source", atMs: 40 }],
    };
    expect(agentSessionBands(items, { c: update })).toMatchObject([
      { tStart: 6, tEnd: 9, progressLog: update.progressLog },
    ]);
    expect(agentSessionBands(items, {})).toEqual([]);
  });

  it("shrinks a merged region when an outer session finishes", () => {
    const items = [
      selection("a", 1000, 4000),
      selection("b", 3000, 7000),
      selection("c", 6000, 9000),
    ];
    expect(
      agentSessionBands(items, { b: progress.b, c: progress.c }),
    ).toMatchObject([
      { tStart: 3, tEnd: 9, progressLog: [{ text: "2 agents running" }] },
    ]);
  });

  it("combines selections sharing an endpoint but leaves separated selections independent", () => {
    const items = [
      selection("a", 1000, 4000),
      selection("b", 4000, 5000),
      selection("c", 6000, 9000),
    ];
    expect(agentSessionBands(items, progress)).toMatchObject([
      { tStart: 1, tEnd: 5, progressLog: [{ text: "2 agents running" }] },
      { tStart: 6, tEnd: 9, progressLog: progress.c.progressLog },
    ]);
  });

  it("ignores hidden, completed and non-session drawings", () => {
    const items = [
      { ...selection("a", 1000, 4000), hidden: true },
      selection("finished", 3000, 7000),
      Drawing.create(
        "trend_line",
        [
          { time: 1, price: 1 },
          { time: 2, price: 2 },
        ],
        { id: "b" },
      ),
      selection("c", 6000, 9000),
    ];
    expect(agentSessionBands(items, progress)).toMatchObject([
      { tStart: 6, tEnd: 9, progressLog: progress.c.progressLog },
    ]);
    expect(agentSessionBands(items)).toEqual([]);
  });
});
