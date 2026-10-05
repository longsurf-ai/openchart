// Purpose: Keep placement creation faithful to the Dashboard schema and dock new widgets beside their anchor.
import { defineId } from "@openchart/identifier";
import { expect, test } from "vitest";

import { verticalCompactor } from "react-grid-layout/core";

import {
  appendWidget,
  placeWidgets,
  placeWidgetBeside,
  widgetLayout,
} from "@openchart/app/features/dashboard/utils/layout";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";

const definition = { kind: "alerts", defaultSize: { w: 6, h: 8 } };

test("the first widget fills the viewport and omits an absent Resource reference", () => {
  const [placement] = appendWidget([], definition);
  expect(placement).toMatchObject({
    kind: "alerts",
    layout: { x: 0, y: 0, w: 12, h: 24 },
  });
  expect(placement).not.toHaveProperty("resourceId");
});

test("adding the second widget splits the viewport without changing identities or the input", () => {
  const first = appendWidget([], definition, "cht_first");
  const [existing, second] = appendWidget(first, definition, "cht_second");
  expect(existing).toEqual({
    ...first[0],
    layout: { x: 0, y: 0, w: 6, h: 24 },
  });
  expect(second).toMatchObject({
    resourceId: "cht_second",
    layout: { x: 6, y: 0, w: 6, h: 24 },
  });
  expect(first[0]!.layout).toEqual({ x: 0, y: 0, w: 12, h: 24 });
});

test("the third widget lands below existing placements without moving them", () => {
  const first = appendWidget([], definition);
  const pair = appendWidget(first, definition);
  const result = appendWidget(pair, definition);
  expect(result[0]).toBe(pair[0]);
  expect(result[1]).toBe(pair[1]);
  expect(result[2]!.layout).toEqual({ x: 0, y: 24, w: 6, h: 8 });
});

const registry = {
  chart: { minSize: { w: 4, h: 6 } },
  workspace: { minSize: { w: 3, h: 6 } },
  other: { minSize: { w: 2, h: 2 } },
} as unknown as Parameters<typeof placeWidgetBeside>[1];
const workspace = { kind: "workspace", minSize: { w: 3, h: 6 } };
type Rectangle = Dashboard["widgets"][number]["layout"];
const placementId = defineId("wdg", "WidgetPlacement.ID");

const overlaps = (a: Rectangle, b: Rectangle) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Dock beside `anchorId` and check what every result must satisfy; returns the saved rectangles. */
function dockChecked(widgets: Dashboard["widgets"], anchorId: string) {
  const result = placeWidgetBeside(
    widgets,
    registry,
    anchorId,
    workspace,
    "wsp_1",
  );
  const saved = result.widgets.map(({ layout }) => layout);
  // Every result is a valid persisted layout: in bounds and never overlapping.
  for (const [index, a] of saved.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w).toBeLessThanOrEqual(12);
    for (const b of saved.slice(index + 1)) expect(overlaps(a, b)).toBe(false);
  }
  // The grid always compacts what it shows, so saving anything else would split the pair on screen.
  expect(
    verticalCompactor
      .compact(widgetLayout(result.widgets, registry), 12)
      .map(({ x, y, w, h }) => ({ x, y, w, h })),
  ).toEqual(saved);
  // Side by side: the new widget touches the anchor's right edge and both end on the same row.
  const anchor = saved[widgets.findIndex(({ id }) => id === anchorId)]!;
  const docked = saved.at(-1)!;
  expect(docked.x).toBe(anchor.x + anchor.w);
  expect(docked.y + docked.h).toBe(anchor.y + anchor.h);
  expect(docked.w).toBeGreaterThanOrEqual(workspace.minSize.w);
  expect(docked.h).toBeGreaterThanOrEqual(workspace.minSize.h);
  // No empty column is left on its right: the next column is the edge or holds a placement.
  const next = docked.x + docked.w;
  if (next < 12)
    expect(
      saved.some((layout) => overlaps(layout, { ...docked, x: next, w: 1 })),
    ).toBe(true);
  // Other placements keep their identity and order; only the new one is appended.
  const identity = ({ id, kind, resourceId }: (typeof widgets)[number]) => ({
    id,
    kind,
    resourceId,
  });
  expect(result.widgets.map(identity)).toEqual([
    ...widgets.map(identity),
    { id: result.id, kind: "workspace", resourceId: "wsp_1" },
  ]);
  return saved;
}

// The chart comes last so docking must find its anchor by ID, not position.
function dock(chart: Rectangle, others: Rectangle[] = []) {
  return dockChecked(
    [
      ...others.map((layout, index) => ({
        id: placementId.make(`wdg_${index}`),
        kind: "other",
        layout,
      })),
      {
        id: placementId.make("wdg_chart"),
        kind: "chart",
        resourceId: "cht_1",
        layout: chart,
      },
    ],
    "wdg_chart",
  );
}

test("the new widget takes all free columns on the chart's right, the chart staying put", () => {
  expect(dock({ x: 0, y: 0, w: 6, h: 24 })).toEqual([
    { x: 0, y: 0, w: 6, h: 24 },
    { x: 6, y: 0, w: 6, h: 24 },
  ]);
  expect(dock({ x: 0, y: 0, w: 4, h: 12 })).toEqual([
    { x: 0, y: 0, w: 4, h: 12 },
    { x: 4, y: 0, w: 8, h: 12 },
  ]);
});

test("a right neighbour crossing only part of the chart's rows still blocks its columns", () => {
  expect(
    dock({ x: 0, y: 0, w: 6, h: 24 }, [{ x: 9, y: 0, w: 3, h: 12 }]),
  ).toEqual([
    { x: 9, y: 0, w: 3, h: 12 },
    { x: 0, y: 0, w: 6, h: 24 },
    { x: 6, y: 0, w: 3, h: 24 },
  ]);
});

test("under a full-width widget, the new widget fills the free right of the chart's rows", () => {
  expect(
    dock({ x: 0, y: 12, w: 6, h: 12 }, [{ x: 0, y: 0, w: 12, h: 12 }]),
  ).toEqual([
    { x: 0, y: 0, w: 12, h: 12 },
    { x: 0, y: 12, w: 6, h: 12 },
    { x: 6, y: 12, w: 6, h: 12 },
  ]);
});

test("the new widget rises to the placements above its own columns and ends with the chart", () => {
  expect(
    dock({ x: 1, y: 13, w: 8, h: 14 }, [
      { x: 0, y: 0, w: 3, h: 9 },
      { x: 5, y: 0, w: 3, h: 13 },
      { x: 0, y: 27, w: 12, h: 4 },
    ]),
  ).toEqual([
    { x: 0, y: 0, w: 3, h: 9 },
    { x: 5, y: 0, w: 3, h: 13 },
    { x: 0, y: 27, w: 12, h: 4 },
    { x: 1, y: 13, w: 8, h: 14 },
    { x: 9, y: 0, w: 3, h: 27 },
  ]);
});

test("a chart at the right edge slides left, keeping its width", () => {
  expect(dock({ x: 6, y: 0, w: 6, h: 12 })).toEqual([
    { x: 0, y: 0, w: 6, h: 12 },
    { x: 6, y: 0, w: 6, h: 12 },
  ]);
  expect(dock({ x: 8, y: 0, w: 4, h: 12 })).toEqual([
    { x: 0, y: 0, w: 4, h: 12 },
    { x: 4, y: 0, w: 8, h: 12 },
  ]);
});

test("a chart sliding left rises into the empty columns, keeping its bottom edge", () => {
  expect(
    dock({ x: 6, y: 12, w: 6, h: 12 }, [{ x: 6, y: 0, w: 6, h: 12 }]),
  ).toEqual([
    { x: 6, y: 0, w: 6, h: 12 },
    { x: 0, y: 0, w: 6, h: 24 },
    { x: 6, y: 12, w: 6, h: 12 },
  ]);
});

test("a full-width chart splits in half with the new widget on its right", () => {
  expect(dock({ x: 0, y: 0, w: 12, h: 12 })).toEqual([
    { x: 0, y: 0, w: 6, h: 12 },
    { x: 6, y: 0, w: 6, h: 12 },
  ]);
});

test("a widget below a full-width chart stays where it is", () => {
  expect(
    dock({ x: 0, y: 0, w: 12, h: 12 }, [{ x: 0, y: 12, w: 12, h: 8 }]),
  ).toEqual([
    { x: 0, y: 12, w: 12, h: 8 },
    { x: 0, y: 0, w: 6, h: 12 },
    { x: 6, y: 0, w: 6, h: 12 },
  ]);
});

test("a chart hemmed in by a neighbour splits its own columns, keeping the larger half", () => {
  expect(
    dock({ x: 0, y: 0, w: 9, h: 12 }, [{ x: 9, y: 0, w: 3, h: 12 }]),
  ).toEqual([
    { x: 9, y: 0, w: 3, h: 12 },
    { x: 0, y: 0, w: 5, h: 12 },
    { x: 5, y: 0, w: 4, h: 12 },
  ]);
});

test("under a half-width widget, the new widget rises into the free half and ends with the chart", () => {
  expect(
    dock({ x: 0, y: 12, w: 12, h: 12 }, [{ x: 0, y: 0, w: 6, h: 12 }]),
  ).toEqual([
    { x: 0, y: 0, w: 6, h: 12 },
    { x: 0, y: 12, w: 6, h: 12 },
    { x: 6, y: 0, w: 6, h: 24 },
  ]);
});

test("under uneven widgets, the narrowed chart rises into the space it freed and ends with the new widget", () => {
  expect(
    dock({ x: 0, y: 12, w: 12, h: 12 }, [
      { x: 0, y: 0, w: 6, h: 8 },
      { x: 6, y: 0, w: 6, h: 12 },
    ]),
  ).toEqual([
    { x: 0, y: 0, w: 6, h: 8 },
    { x: 6, y: 0, w: 6, h: 12 },
    { x: 0, y: 8, w: 6, h: 16 },
    { x: 6, y: 12, w: 6, h: 12 },
  ]);
});

test("free columns under a shorter right neighbour take the new widget and nothing moves", () => {
  expect(
    dock({ x: 0, y: 0, w: 6, h: 24 }, [{ x: 6, y: 0, w: 6, h: 12 }]),
  ).toEqual([
    { x: 6, y: 0, w: 6, h: 12 },
    { x: 0, y: 0, w: 6, h: 24 },
    { x: 6, y: 12, w: 6, h: 12 },
  ]);
});

test("room under a shorter right neighbour wins over splitting a chart wide enough to split", () => {
  expect(
    dock({ x: 0, y: 0, w: 8, h: 24 }, [{ x: 8, y: 0, w: 4, h: 8 }]),
  ).toEqual([
    { x: 8, y: 0, w: 4, h: 8 },
    { x: 0, y: 0, w: 8, h: 24 },
    { x: 8, y: 8, w: 4, h: 16 },
  ]);
});

test("without room, the pushed neighbour's columns go to the pair instead of staying empty", () => {
  expect(
    dock({ x: 0, y: 0, w: 4, h: 12 }, [{ x: 4, y: 0, w: 8, h: 12 }]),
  ).toEqual([
    { x: 4, y: 12, w: 8, h: 12 },
    { x: 0, y: 0, w: 4, h: 12 },
    { x: 4, y: 0, w: 8, h: 12 },
  ]);
  expect(
    dock({ x: 8, y: 0, w: 4, h: 12 }, [{ x: 0, y: 0, w: 8, h: 12 }]),
  ).toEqual([
    { x: 0, y: 12, w: 8, h: 12 },
    { x: 0, y: 0, w: 4, h: 12 },
    { x: 4, y: 0, w: 8, h: 12 },
  ]);
  expect(
    dock({ x: 6, y: 0, w: 6, h: 24 }, [{ x: 0, y: 0, w: 6, h: 12 }]),
  ).toEqual([
    { x: 0, y: 24, w: 6, h: 12 },
    { x: 0, y: 0, w: 6, h: 24 },
    { x: 6, y: 0, w: 6, h: 24 },
  ]);
});

test("a chart saved below where the grid shows it docks where it is shown", () => {
  // Saved, the chart's rows are free on the right; shown, the tall widget blocks them.
  expect(
    dock({ x: 0, y: 24, w: 6, h: 8 }, [
      { x: 0, y: 0, w: 6, h: 8 },
      { x: 6, y: 0, w: 6, h: 24 },
    ]),
  ).toEqual([
    { x: 0, y: 0, w: 6, h: 8 },
    { x: 6, y: 16, w: 6, h: 24 },
    { x: 0, y: 8, w: 6, h: 8 },
    { x: 6, y: 0, w: 6, h: 16 },
  ]);
});

/** Deterministic PRNG (mulberry32) so a failing dashboard can be replayed from its seed. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Checks the ordered cases against a cell-by-cell oracle of the anchor's free columns; returns the case checked. */
function dockAgainstOracle(widgets: Dashboard["widgets"], anchorIndex: number) {
  const anchor = widgets[anchorIndex]!;
  const saved = dockChecked(widgets, anchor.id);
  const { x, y, w, h } = anchor.layout;
  const minSize = workspace.minSize;
  // The anchor's free run of columns on rows [top, anchor bottom).
  const run = (top: number) => {
    const free = (column: number) =>
      widgets.every(
        (widget) =>
          widget === anchor ||
          !overlaps(widget.layout, { x: column, y: top, w: 1, h: y + h - top }),
      );
    let left = x;
    while (left > 0 && free(left - 1)) left--;
    let right = x + w;
    while (right < 12 && free(right)) right++;
    return { left, right };
  };
  const { left, right } = run(y);
  const span = right - left;
  const anchorMinW = registry[anchor.kind]!.minSize.w;
  const [placed, docked] = [saved[anchorIndex]!, saved.at(-1)!];
  const unmoved = (layouts: Rectangle[]) =>
    layouts.filter((_, index) => index !== anchorIndex);
  // Case 1: free right columns on the tallest band of the anchor's lowest rows; nothing moves.
  for (let top = y; top + minSize.h <= y + h; top++) {
    const shelf = run(top).right - x - w;
    if (shelf < minSize.w) continue;
    expect(saved.slice(0, -1)).toEqual(widgets.map(({ layout }) => layout));
    expect([docked.x, docked.w, docked.y + docked.h]).toEqual([
      x + w,
      shelf,
      y + h,
    ]);
    // The full-height band may rise to the placements above; a shorter shelf starts at its band.
    if (top === y) expect(docked.y).toBeLessThanOrEqual(y);
    else expect(docked.y).toBe(top);
    return "case 1";
  }
  let branch: "case 2" | "case 3" | "short anchor";
  if (right - x - w >= minSize.w) {
    branch = "short anchor";
    expect([placed.x, placed.w]).toEqual([x, w]);
  } else if (span - w >= minSize.w) {
    branch = "case 2";
    expect([placed.x, placed.w]).toEqual([left, w]);
  } else if (span >= anchorMinW + minSize.w) {
    branch = "case 3";
    expect(placed.x).toBe(left);
    expect(docked.w).toBe(
      Math.min(Math.max(Math.floor(span / 2), minSize.w), span - anchorMinW),
    );
  } else return "case 4";
  expect(docked.x + docked.w).toBe(right);
  // A shorter anchor grows down to the new widget's minimum height and may push what is below.
  if (h < minSize.h) return "short anchor";
  expect(placed.y + placed.h).toBe(y + h);
  expect(unmoved(saved.slice(0, -1))).toEqual(
    unmoved(widgets.map(({ layout }) => layout)),
  );
  return branch;
}

const seed = 20260926;
const dashboards = 4000;

test(`random compacted dashboards dock beside any anchor (seed ${seed}, ${dashboards} dashboards)`, () => {
  const next = random(seed);
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const kinds = ["chart", "workspace", "other"] as const;
  const branches = {
    "case 1": 0,
    "case 2": 0,
    "case 3": 0,
    "case 4": 0,
    "short anchor": 0,
  };
  for (let run = 0; run < dashboards; run++) {
    const generated: Dashboard["widgets"] = Array.from(
      { length: int(1, 9) },
      (_, index) => {
        const kind = kinds[int(0, kinds.length - 1)]!;
        const min = registry[kind]!.minSize;
        // Narrow widths are drawn more often so crowded rows (case 4) come up.
        const w = int(min.w, int(min.w, 12));
        return {
          id: placementId.make(`wdg_${index}`),
          kind,
          layout: {
            x: int(0, 12 - w),
            y: int(0, 40),
            w,
            h: int(min.h, min.h + 14),
          },
        };
      },
    );
    // Start from what the grid would show: a compacted dashboard.
    const widgets = placeWidgets(
      generated,
      verticalCompactor.compact(widgetLayout(generated, registry), 12),
    );
    try {
      branches[dockAgainstOracle(widgets, int(0, widgets.length - 1))]++;
    } catch (error) {
      throw new Error(`seed ${seed}, dashboard ${run}`, { cause: error });
    }
  }
  // The generator reaches every branch often enough to matter.
  expect(Math.min(...Object.values(branches))).toBeGreaterThan(10);
  // About 1 s locally and 5 s on CI runners; the case count keeps rare branches covered.
}, 30_000);
