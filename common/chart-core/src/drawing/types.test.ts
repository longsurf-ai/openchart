// Purpose: Preserve drawing data, defaults and completed-geometry rules across schema consumers.
import { Schema } from "effect";
import { assert, describe, expect, it } from "vitest";
import { Data } from "@openchart/chart-core/data/schema";
import { ChartAnnotation } from "@openchart/chart-core/annotation/types";
import { Drawing } from "./types";

describe("shared drawing schemas", () => {
  it("preserves defaults and mutable, independently decoded drawing values", () => {
    const input = {
      id: "text",
      type: "text",
      anchors: [{ time: 1, price: 2 }],
    };
    const first = Schema.decodeUnknownSync(Drawing.Item)(input);
    const second = Schema.decodeUnknownSync(Drawing.Item)(input);
    expect(first).toEqual({
      ...input,
      text: "Text",
      locked: false,
      hidden: false,
      style: {
        lineColor: "#000000",
        lineWidth: 1,
        lineStyle: "solid",
        textColor: "#000000",
        fontSize: 12,
        opacity: 1,
        startCap: "none",
        endCap: "none",
        middlePoint: false,
        priceLabels: false,
      },
    });
    assert(first.type === "text");
    first.style.lineWidth = 3;
    first.anchors[0]!.price = 4;
    first.anchors.push({ time: 2, price: 5 });
    expect(second.style.lineWidth).toBe(1);
    expect(second.anchors).toEqual(input.anchors);
    expect(
      Schema.decodeUnknownSync(Drawing.Item)({ ...input, style: undefined }),
    ).toEqual(second);
    expect(Drawing.createState()).toEqual({ toolLocked: false });
  });

  it("permits drafts but enforces the existing completion rules for saved drawings", () => {
    for (const type of Drawing.Type.literals) {
      const anchors = Array.from(
        { length: Drawing.requiredAnchors(type) },
        (_, i) => ({ time: i, price: i }),
      );
      const complete =
        type === "agent_session"
          ? Schema.decodeUnknownSync(Drawing.AgentSessionItem)({
              id: "session",
              type,
              anchors,
              range: { from: 1000, to: 2000 },
            })
          : Drawing.create(
              type,
              anchors,
              type === "annotation"
                ? {
                    time: 1000,
                    title: "Earnings",
                    body: "Revenue rose.",
                    sources: [],
                    sentiment: 0.5,
                  }
                : undefined,
            );
      expect(Schema.decodeUnknownSync(Drawing.SavedItem)(complete)).toEqual(
        complete,
      );
      if (anchors.length > 0) {
        const draft = Drawing.create(type, anchors.slice(1));
        expect(Schema.is(Drawing.Item)(draft)).toBe(true);
        expect(Schema.is(Drawing.SavedItem)(draft)).toBe(false);
      }
      expect(Schema.is(Drawing.SavedItem)({ ...complete, id: "" })).toBe(false);
    }
  });

  it("saves a fixed-range volume profile at one price but not at one time", () => {
    const save = Schema.is(Drawing.SavedItem);
    expect(
      save(
        Drawing.create("volume_profile", [
          { time: 1000, price: 10 },
          { time: 2000, price: 10 },
        ]),
      ),
    ).toBe(true);
    expect(
      save(
        Drawing.create("volume_profile", [
          { time: 1000, price: 10 },
          { time: 1000, price: 20 },
        ]),
      ),
    ).toBe(false);
    expect(
      save(Drawing.create("volume_profile", [{ time: 1000, price: 10 }])),
    ).toBe(false);
  });

  it("keeps agent-session ranges ordered and free of price anchors", () => {
    const input = {
      id: "session",
      type: "agent_session",
      anchors: [],
      range: { from: 1000, to: 2000 },
    };
    const decode = Schema.decodeUnknownSync(Drawing.SavedItem);
    expect(decode(input)).toMatchObject(input);
    expect(() =>
      decode({ ...input, range: { from: 2000, to: 1000 } }),
    ).toThrow();
    expect(() =>
      decode({ ...input, anchors: [{ time: 1, price: 2 }] }),
    ).toThrow();
  });

  it("rejects surplus anchors for fixed geometry while retaining variable strokes", () => {
    const point = (i: number) => ({ time: i, price: i });
    for (const type of Drawing.Type.literals) {
      if (type === "annotation" || type === "agent_session") continue;
      const item = Drawing.create(
        type,
        Array.from({ length: Drawing.requiredAnchors(type) + 1 }, (_, i) =>
          point(i),
        ),
      );
      expect(Schema.is(Drawing.SavedItem)(item), type).toBe(
        type === "polyline" || type === "freehand",
      );
    }
  });

  it("rejects degenerate saved geometry without excluding vertical lines or retraced paths", () => {
    const a = { time: Date.parse("2026-09-20") / 1000, price: 100 };
    const same = { ...a };
    const above = { time: Date.parse("2026-09-20") / 1000, price: 110 };
    const later = { time: Date.parse("2026-09-21") / 1000, price: 100 };
    const diagonal = { time: Date.parse("2026-09-21") / 1000, price: 110 };
    const valid = (type: Drawing.Type, anchors: Drawing.Anchor[]) =>
      Schema.is(Drawing.SavedItem)(Drawing.create(type, anchors));
    for (const type of [
      "trend_line",
      "ray",
      "extended_line",
      "circle",
    ] as const) {
      expect(valid(type, [a, same]), type).toBe(false);
      expect(valid(type, [a, above]), type).toBe(true);
      expect(valid(type, [a, later]), type).toBe(true);
    }
    for (const type of ["rectangle", "ellipse", "triangle"] as const) {
      expect(valid(type, [a, above]), type).toBe(false);
      expect(valid(type, [a, later]), type).toBe(false);
      expect(valid(type, [a, diagonal]), type).toBe(true);
    }
    for (const type of ["parallel_channel", "fib_channel"] as const)
      expect(valid(type, [a, same, diagonal]), type).toBe(false);
    expect(valid("fib_retracement", [a, later])).toBe(false);
    expect(valid("fib_extension", [a, later, diagonal])).toBe(false);
    for (const type of ["curved_line", "polyline", "freehand"] as const) {
      const count = Drawing.requiredAnchors(type);
      expect(
        valid(
          type,
          Array.from({ length: count }, () => a),
        ),
        type,
      ).toBe(false);
      expect(valid(type, [a, diagonal, a]), type).toBe(true);
    }
  });

  it("saves annotation content with optional manual placement and no unrelated fields", () => {
    const item = Drawing.create("annotation", [], {
      time: 1000,
      title: "Earnings",
      body: "Revenue rose.",
      sources: [{ title: "Report", url: "https://example.com/report" }],
      sentiment: 0.5,
    });
    const decode = Schema.decodeUnknownSync(Drawing.SavedItem);
    expect(decode(JSON.parse(JSON.stringify(item)))).toEqual(item);
    expect(() =>
      decode({ ...item, anchors: [{ time: 1000, price: 100 }] }),
    ).toThrow();
    const positioned = Drawing.create("annotation", [], {
      ...item,
      labelAnchor: { time: 2000, price: 110 },
    });
    expect(decode(JSON.parse(JSON.stringify(positioned)))).toEqual(positioned);
    expect(() =>
      decode({ ...item, labelAnchor: { time: 2000, price: Infinity } }),
    ).toThrow();
    expect(() => decode({ ...item, name: "Other title" })).toThrow();
    expect(() => decode({ ...item, eventId: "legacy" })).toThrow();
    expect(() =>
      decode({
        ...item,
        sources: [{ title: "Unsafe", url: "javascript:alert(1)" }],
      }),
    ).toThrow();
  });

  it("shares time validation between drawings, annotations and existing data schemas", () => {
    for (const time of [0, -1, 1, 1775534400, 1775534400.125]) {
      const anchor = { time, price: 100 };
      expect(Schema.decodeUnknownSync(Drawing.Anchor)(anchor)).toEqual(anchor);
      expect(
        Schema.decodeUnknownSync(ChartAnnotation.ChartPointAnchor)(anchor),
      ).toEqual(anchor);
      expect(Data.Whitespace.parse({ time })).toEqual({ time });
    }
    for (const time of [
      "2026-09-20",
      "2026-09-20T00:00:00Z",
      { year: 2026, month: 9, day: 20 },
      1775534400000,
      NaN,
      Infinity,
      { year: 2026, month: 9 },
      null,
      "not-a-date",
      "2026-02-31",
      "2026-02-31T00:00:00Z",
      "2026-09-20T24:00:00Z",
      "2026-09-20T12:00:00",
      { year: 2026, month: 2, day: 29 },
      { year: 2026, month: 13, day: 1 },
      { year: 2026, month: 2, day: 1.5 },
    ]) {
      expect(Schema.is(Drawing.Anchor)({ time, price: 100 })).toBe(false);
      expect(Data.Whitespace.safeParse({ time }).success).toBe(false);
    }
  });

  it("retains finite numeric and style constraints", () => {
    for (const style of [
      { lineWidth: 0 },
      { fontSize: 7 },
      { opacity: 2 },
      { lineWidth: Infinity },
    ]) {
      expect(() => Schema.decodeUnknownSync(Drawing.Style)(style)).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(ChartAnnotation.Style)(style),
      ).toThrow();
    }
  });
});
