// Purpose: Tests for ChartStateModel.assertModelReady — validates schema version, panes, objects, and membership invariants
// Module:  @openchart/chart-core / v2 / state

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ChartObjectId,
  type Chart,
  type ChartId,
  type ChartObjectId as ChartObjectIdType,
} from "@openchart/chart-core/chart/state";
import { createState } from "./defaults";
import { ChartStateModel } from "./model";
import { ChartStateUtils } from "./utilities";

describe("ChartStateModel.assertModelReady", () => {
  it("accepts canonical state from createState", () => {
    const state = createState({
      series: {
        main: { type: "Line" },
      },
    });

    expect(() => ChartStateModel.assertModelReady(state)).not.toThrow();
  });

  it("exposes the object graph as a closed discriminated union", () => {
    const state = createState({
      id: "chart_1",
      series: {
        main: { type: "Line" },
      },
    });
    const chartId: ChartId = state.id;
    const objectId = ChartObjectId.parse("main");
    const object = state.objects[objectId];
    const typedObjectId: ChartObjectIdType = object.id;

    expectTypeOf(chartId).toEqualTypeOf<ChartId>();
    expectTypeOf(typedObjectId).toEqualTypeOf<ChartObjectIdType>();
    expectTypeOf<ChartId>().not.toMatchTypeOf<ChartObjectIdType>();
    expectTypeOf<ChartObjectIdType>().not.toMatchTypeOf<ChartId>();
    expectTypeOf<ChartId>().not.toMatchTypeOf<keyof Chart.State["objects"]>();
    expect(object.kind).toBe("series");
    if (object.kind !== "series") throw new Error("expected series object");
    expect(object.series.id).toBe("main");
  });

  it("rejects an unsupported runtime object kind", () => {
    const state = createState();
    const objects = state.objects as unknown as Record<string, unknown>;
    objects.invalid = {
      id: "invalid",
      kind: "unsupported",
      paneId: "pane-main",
    };
    state.panes[0]!.objectIds.push(ChartObjectId.parse("invalid"));

    expect(() => ChartStateModel.assertModelReady(state)).toThrow(
      /E_OBJECT_KIND_INVALID/,
    );
  });

  it("throws when objects map is missing", () => {
    const state = createState();
    delete (state as unknown as { objects?: unknown }).objects;

    expect(() => ChartStateModel.assertModelReady(state)).toThrow(
      /E_OBJECTS_MISSING/,
    );
  });

  it("throws when a series object is missing", () => {
    const state = createState({
      series: {
        main: { type: "Line" },
      },
    });
    delete state.objects[ChartObjectId.parse("main")];

    expect(() => ChartStateModel.assertModelReady(state)).toThrow(
      /E_PANE_OBJECT_REF_MISSING/,
    );
  });

  it("throws when pane membership is mismatched", () => {
    const state = createState({
      series: {
        main: { type: "Line" },
      },
    });
    state.panes[0]!.objectIds = [];

    expect(() => ChartStateModel.assertModelReady(state)).toThrow(
      /E_SERIES_OBJECT_ORPHAN/,
    );
  });

  it("derives pane index from pane membership", () => {
    const state = createState({
      series: {
        main: { type: "Line" },
      },
    });

    expect(() => ChartStateModel.assertModelReady(state)).not.toThrow();
    expect(ChartStateModel.paneIndexForSeriesId(state, "main")).toBe(0);
  });

  it("throws when pane ordering metadata is invalid", () => {
    const state = createState({
      series: {
        main: { type: "Line" },
      },
    });
    state.panes[0]!.index = 99;

    expect(() => ChartStateModel.assertModelReady(state)).toThrow(
      /E_PANE_INDEX_INVALID/,
    );
  });

  it("accepts stable non-ordinal pane ids for non-main panes", () => {
    const state = createState();
    state.panes.push({
      id: "pane_custom_secondary",
      index: 1,
      height: 200,
      objectIds: [],
    });

    expect(() => ChartStateModel.assertModelReady(state)).not.toThrow();
  });

  it("throws when schemaVersion is invalid", () => {
    const state = createState({
      series: {
        main: { type: "Line" },
      },
    });
    state.schemaVersion = 1;

    expect(() => ChartStateModel.assertModelReady(state)).toThrow(
      /E_SCHEMA_VERSION/,
    );
  });
});

describe("vertical profile objects", () => {
  const profile = {
    box: { kind: "edge", side: "right", width: 0.25 },
    rows: [{ low: 1, high: 2, segments: [{ value: 1, color: "#26a69a" }] }],
    levels: [],
    visible: true,
  } as const satisfies Chart.VerticalProfileObject["profile"];

  it("joins its pane, moves with it, and leaves on removal", () => {
    const state = createState();
    state.panes.push({ id: "pane-b", index: 1, height: 100, objectIds: [] });
    const place = (paneId: string) =>
      ChartStateModel.upsertVerticalProfileObject(state, {
        id: "vp",
        paneId,
        axisId: "right",
        profile,
      });
    place(ChartStateModel.MAIN_PANE_ID);
    place("pane-b");
    expect(state.panes.map((pane) => pane.objectIds)).toEqual([[], ["vp"]]);
    expect(() => ChartStateModel.assertModelReady(state)).not.toThrow();

    ChartStateModel.removeVerticalProfileObject(state, "vp");
    expect(state.objects).toEqual({});
    expect(state.panes[1]!.objectIds).toEqual([]);
  });

  it("refuses another kind's id and an unknown pane", () => {
    const state = createState({ series: { main: { type: "Line" } } });
    const place = (id: string, paneId: string) => () =>
      ChartStateModel.upsertVerticalProfileObject(state, {
        id,
        paneId,
        axisId: "right",
        profile,
      });
    expect(place("main", ChartStateModel.MAIN_PANE_ID)).toThrow(
      /not a vertical profile/,
    );
    expect(place("vp", "nowhere")).toThrow(/Unknown vertical profile pane/);
    ChartStateModel.removeVerticalProfileObject(state, "main");
    expect(state.objects[ChartObjectId.parse("main")]?.kind).toBe("series");
  });

  it("keeps a pane alive while its owner still holds a profile there", () => {
    const state = createState({ series: { main: { type: "Line" } } });
    const seriesId = ChartStateUtils.addSeries(state, {
      id: "aux",
      type: "Line",
      pane: 1,
      yAxisId: "aux:axis",
      fieldMap: { x: "time", value: "value" },
    });
    const paneId = state.panes[1]!.id;
    ChartStateModel.upsertVerticalProfileObject(state, {
      id: "vp",
      paneId,
      axisId: "aux:axis",
      profile,
    });
    ChartStateUtils.removeSeries(state, seriesId);
    expect(state.panes.map((pane) => pane.id)).toContain(paneId);
    expect(() => ChartStateModel.assertModelReady(state)).not.toThrow();
  });
});
