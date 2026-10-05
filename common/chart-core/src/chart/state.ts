// Purpose: Chart state types, factory, and pure query/layout helpers (panes, crosshair, axes, time-scale)
// Module:  @openchart/chart-core / chart

import type { ProviderListing } from "@openchart/market";
/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Schema } from "effect";
import { Data } from "@openchart/chart-core/data";
import { Series } from "@openchart/chart-core/series";
import { TimeScale } from "@openchart/chart-core/scale";
import { ChartConfig } from "@openchart/chart-core/config";
import { Drawing } from "@openchart/chart-core/drawing";
import {
  ChartAnnotation,
  type AnnotationExpandedCardContent,
  type AnnotationSourceBadge,
} from "@openchart/chart-core/annotation";
import { Marker } from "@openchart/chart-core/marker";
import { Strategy } from "@openchart/chart-core/strategy";
import type { VerticalProfile } from "@openchart/chart-core/vertical-profile";
import type {
  YAxisConfig,
  XAxisConfig,
} from "@openchart/chart-core/scale/config";
import * as Tz from "@openchart/chart-core/tz/types";

type Axis = YAxisConfig.Axis;
type XAxis = XAxisConfig.Axis;

export const ChartId = z.string().brand<"ChartId">();
export type ChartId = z.infer<typeof ChartId>;
export const ChartObjectId = z.string().brand<"ChartObjectId">();
export type ChartObjectId = z.infer<typeof ChartObjectId>;

export namespace Chart {
  type PaneRef = { id?: string | null };
  type SeriesObjectRef = {
    kind?: string;
    paneId?: string;
    axisId?: string;
    series?: {
      axisId?: string;
      yAxisId?: string;
    };
  };

  /** Shared data backing one or more visual series. */
  export type DataSeriesEntry = {
    id: string;
    data: unknown[];
    columns: string[];
  };

  export type IndicatorNode = {
    id: string;
    definitionId?: string;
    name: string;
    outputObjectIds?: string[];
    /** The shared DataSeriesEntry backing this indicator's visual outputs. */
    dataSeriesId?: string;
    createdAt?: number;
    updatedAt?: number;
  };

  // @agent invariant: ChartId identifies a whole chart document, while
  // ChartObjectId identifies an entry inside that chart's object graph.
  export type SeriesObject = {
    id: ChartObjectId;
    kind: "series";
    paneId: string;
    seriesId: ChartObjectId;
    axisId: string;
    source: "provider" | "derived" | "computed" | "metric";
    /** Authored display role; Resource consumers can retain native object IDs. */
    role?: "main" | "normal";
    comparable: boolean;
    /** Reference to optional shared data in chart.dataSeries[dataRef]. Visual series data remains authoritative once populated. */
    dataRef?: string;
    series: Series.State;
  };

  export type DrawingObject = {
    id: ChartObjectId;
    kind: "drawing";
    paneId: string;
    item: Drawing.Item;
    owner?: { kind: "indicator"; indicatorInstanceId: string };
  };

  /** A transient vertical profile drawn on `axisId`'s y scale; never persisted. */
  export type VerticalProfileObject = {
    id: ChartObjectId;
    kind: "vertical-profile";
    paneId: string;
    axisId: string;
    profile: VerticalProfile.State;
  };

  export type ObjectState =
    SeriesObject | DrawingObject | VerticalProfileObject;

  export const Pane = z.object({
    id: z.string().default("pane-main"),
    index: z.number(),
    height: z.number(),
    objectIds: z.array(ChartObjectId).default([]),
  });
  export type Pane = z.infer<typeof Pane>;

  export const CrosshairState = z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    visible: z.boolean().default(false),
    logicalIndex: z.number().optional(),
    time: z.custom<Data.Time>(Schema.is(Data.Time)).optional(),
    paneId: z.string().optional(),
  });
  export type CrosshairState = z.infer<typeof CrosshairState>;

  /**
   * Per-series session context driving the y-axis ticker badge.
   * Populated transiently by the chart widget from a market-snapshot + calendar
   * status subscription — not persisted. Extended-session candle streams own
   * their latest price and active pre/post band. Regular-session candle streams
   * keep their primary tag on the regular close and use the secondary Pre/Post
   * fields for the live extended-hours price.
   */
  export type SessionInfo = {
    /** Market phase at this moment. */
    phase: "pre" | "open" | "post" | "closed" | "break";
    /**
     * Unix seconds of the next countdown boundary. For equity this is the
     * venue's next regular-session close; for crypto it is the next UTC
     * midnight (daily bar close). Undefined means "no countdown".
     */
    nextCloseAt?: number;
    /**
     * Unix seconds of the current countdown/session window start. Used by the
     * renderer to shade the whole active pre/post block even before future
     * bars have arrived.
     */
    currentSessionOpenAt?: number;
    /** Regular-session close anchoring a regular-stream pre/post tag pair. */
    regularClose?: number;
    /** Live extended-session price for a regular-stream secondary tag. */
    extendedPrice?: number;
    /** Label for the secondary extended-session tag (e.g. "Post", "Pre"). */
    extendedLabel?: string;
  };

  /**
   * Runtime-only owner selection for interpreting a series' numeric times.
   * Instants follow the user's display timezone. Calendar periods retain the
   * resolved grid calendar timezone so their period date is globally stable.
   */
  export type TimeDisplayContext =
    | { readonly kind: "instant" }
    | { readonly kind: "calendar-period"; readonly timezone: Tz.Name };

  /**
   * Chart-native relative-performance comparison mode. The axis `modeAnchor`
   * remains the single source of truth for the anchor timestamp; this state
   * describes which chart/series relationship should expose the interaction.
   */
  export type ComparisonAdjustment =
    | { kind: "none" }
    | { kind: "volatility" }
    | { kind: "beta_to_main" }
    | {
        kind: "beta_to_custom_benchmark";
        benchmarkListingId?: number;
        benchmarkSymbol?: string;
      };

  export type ComparisonState = {
    enabled: boolean;
    mode?: "relative_performance";
    axisId: string;
    mainSeriesId: string;
    /**
     * Stable baseline for the emphasized series. Dragging the comparison
     * anchor changes where returns are measured from, but must not rebase the
     * main listing itself or it will visually drift under the user's hand.
     */
    mainBaselineTime?: number;
    auxiliarySeriesIds: string[];
    adjustment: ComparisonAdjustment;
    display?: "indexed_to_main_at_anchor" | "percentage_from_anchor";
    yScale?: "linear" | "logarithmic";
    /**
     * When enabled, percentage comparison autoscale centers the 0% return line
     * instead of placing it wherever max-content extent fitting lands.
     */
    fixedZeroAxis?: boolean;
    /**
     * Y-axis layout to restore when comparison mode exits. Enabling comparison
     * temporarily combines comparable pane series onto one axis; exit must put
     * pre-existing series back on their prior axes instead of leaving the chart
     * flattened.
     */
    previousYAxisLayout?: {
      axes: Axis[];
      seriesAxisIds: Record<string, string>;
    };
    /**
     * Series presentation to restore when comparison mode exits. Comparison
     * mode temporarily makes price series lines and hides runtime volume.
     */
    previousSeriesPresentation?: {
      series: Record<
        string,
        {
          type: string;
          options: Record<string, unknown>;
          fieldMap?: Series.FieldMap;
        }
      >;
    };
    /**
     * Legacy single-axis restore payload. New comparison owners should use
     * `previousYAxisLayout`; this fallback only protects older persisted state.
     */
    previousAxis?: Pick<
      Axis,
      "mode" | "autoScale" | "visibleExtent" | "labels" | "margins"
    >;
    source?:
      | { kind: "manual" }
      | { kind: "toolbar" }
      | { kind: "index_analysis"; versionId: string }
      | { kind: "symbol_comparison" };
  };

  export type PersistentState = {
    id: ChartId;
    schemaVersion?: number;
    config: ChartConfig.Full;
    panes: Pane[];
    objects: Record<ChartObjectId, ObjectState>;
    indicators: Record<string, IndicatorNode>;
    /** Shared data backing for visual series that reference via dataRef. */
    dataSeries?: Record<string, DataSeriesEntry>;
    /** Durable chart-native relative-performance comparison configuration. */
    comparison?: ComparisonState;
    display?: Tz.Name;
  };

  export type TransientState = {
    crosshair: z.infer<typeof CrosshairState>;
    hoveredAxisId?: string;
    hoveredSeriesId?: string;
    lockedSeriesId?: string;
    focusedSeriesId?: string;
    magnetSeriesId?: string;
    seriesContextMenu?: {
      seriesId: string;
      seriesIds?: string[];
      x: number;
      y: number;
      clientX: number;
      clientY: number;
    };
    yAxisContextMenu?: {
      axisId: string;
      floating?: boolean;
      x: number;
      y: number;
      clientX?: number;
      clientY?: number;
    };
    visibleRanges: Record<string, { from: number; to: number }>;
    drawings: Drawing.State;
    annotations: ChartAnnotation.Record[];
    sourceBadgesByAnnotationId?: Record<
      string,
      readonly AnnotationSourceBadge[]
    >;
    expandedCardsByAnnotationId?: Record<string, AnnotationExpandedCardContent>;
    agentAnnotationIds?: Record<string, true>;
    markers: Marker.Record[];
    /** Runtime strategy executions; scripts own orders and the chart owns their automatic presentation. */
    strategy?: Strategy.State;
    hoveredAnnotationId?: string;
    expandedAnnotation?: ChartAnnotation.Expansion;
    activeAnnotationId?: string;
    editingAnnotationId?: string;
    hoveredMarkerId?: string;
    activeMarkerId?: string;
    hoveredAnnotationPart?:
      "body" | "target_handle" | "label_handle" | "expand_button";
    annotationCreate?:
      | { phase: "armed" }
      | {
          phase: "placing" | "editing" | "saving" | "error";
          id: string;
          anchor: ChartAnnotation.Anchor;
          label: string;
          clientAnchor: { x: number; y: number };
          clientPill?: { x: number; y: number; width: number; height: number };
          message?: string;
        };
    annotationDebug?: {
      view: "chart" | "occupancy";
    };
    chartExplain?: {
      mode?: "thinking" | "fast";
      draftBand?: {
        xStart: number;
        xEnd: number;
        tStart?: number;
        tEnd?: number;
        color: string;
        translucent: true;
        mode?: "dragging" | "annotating";
        startedAtMs?: number;
        spanId?: string;
        market?: ProviderListing;
        progressLog?: Array<{ text: string; atMs: number }>;
      };
      progressBands?: Array<{
        xStart: number;
        xEnd: number;
        tStart: number;
        tEnd: number;
        color: string;
        translucent: true;
        mode: "annotating";
        startedAtMs: number;
        spanId: string;
        market: ProviderListing;
        progressLog?: Array<{ text: string; atMs: number }>;
      }>;
    };
    /**
     * Transient per-series session context (keyed by seriesId) used by the
     * y-axis ticker badge to render countdown/session chrome. Owned
     * by the chart widget, not persisted.
     */
    session?: Record<string, SessionInfo>;
    /** Runtime-only time interpretation keyed by visual series id. */
    timeDisplayContexts?: Record<string, TimeDisplayContext>;
  };

  export type State = PersistentState & TransientState;

  export function resolveTimeDisplayTimezone(
    state: Pick<State, "display" | "timeDisplayContexts">,
    seriesId: string | undefined,
  ): Tz.Name {
    const context = seriesId
      ? state.timeDisplayContexts?.[seriesId]
      : undefined;
    return context?.kind === "calendar-period"
      ? context.timezone
      : (state.display ?? Tz.LOCAL);
  }

  export function create(
    id: string,
    initialConfig: Partial<ChartConfig.Full> = {},
  ): State {
    const config = ChartConfig.create(initialConfig);
    return {
      id: ChartId.parse(id),
      schemaVersion: 3,
      config,
      panes: [
        {
          id: "pane-main",
          index: 0,
          height: config.chart.dimensions.height,
          objectIds: [],
        },
      ],
      objects: {},
      indicators: {},
      dataSeries: {},
      crosshair: { visible: false },
      visibleRanges: {},
      drawings: Drawing.createState(),
      annotations: [],
      sourceBadgesByAnnotationId: {},
      expandedCardsByAnnotationId: {},
      agentAnnotationIds: {},
      markers: [],
      chartExplain: {},
    };
  }

  export function getAxis(state: State, axisId: string) {
    return (state.config.yAxis.axes as Axis[]).find((a) => a.id === axisId);
  }

  export function getAxesBySide(state: State, side: "left" | "right") {
    return (state.config.yAxis.axes as Axis[]).filter((a) => a.side === side);
  }

  /**
   * Repair persisted y-axis pane membership against the current pane/object graph.
   * Orphaned axes that no longer belong to a live pane or series owner are dropped.
   */
  export function repairYAxisPaneMembership(
    config: unknown,
    panes: PaneRef[] | null | undefined,
    objects: Record<string, unknown> | null | undefined,
  ): unknown {
    if (!config || typeof config !== "object") return config;

    const root = config as {
      yAxis?: {
        axes?: Axis[];
      };
    };
    const axes = root.yAxis?.axes;
    if (!Array.isArray(axes)) return config;

    const validPaneIds = new Set<string>(["pane-main"]);
    for (const pane of panes ?? []) {
      if (!pane || typeof pane !== "object") continue;
      if (typeof pane.id === "string" && pane.id.length > 0) {
        validPaneIds.add(pane.id);
      }
    }

    const ownerPaneIdByAxisId = new Map<string, string>();
    for (const object of Object.values(objects ?? {})) {
      if (!object || typeof object !== "object") continue;
      const seriesObject = object as SeriesObjectRef;
      if (seriesObject.kind !== "series") continue;
      if (
        typeof seriesObject.paneId !== "string" ||
        seriesObject.paneId.length === 0
      ) {
        continue;
      }
      const axisId =
        typeof seriesObject.axisId === "string" &&
        seriesObject.axisId.length > 0
          ? seriesObject.axisId
          : typeof seriesObject.series?.axisId === "string" &&
              seriesObject.series.axisId.length > 0
            ? seriesObject.series.axisId
            : typeof seriesObject.series?.yAxisId === "string" &&
                seriesObject.series.yAxisId.length > 0
              ? seriesObject.series.yAxisId
              : null;
      if (!axisId || ownerPaneIdByAxisId.has(axisId)) continue;
      ownerPaneIdByAxisId.set(axisId, seriesObject.paneId);
    }

    const nextAxes: Axis[] = [];
    const seenAxisIds = new Set<string>();
    for (const axis of axes) {
      if (!axis || typeof axis !== "object") continue;
      const axisId = typeof axis.id === "string" ? axis.id : null;
      if (axisId && seenAxisIds.has(axisId)) continue;

      const explicitPaneId =
        typeof axis.paneId === "string" && axis.paneId.length > 0
          ? axis.paneId
          : null;
      const ownerPaneId = axisId ? ownerPaneIdByAxisId.get(axisId) : undefined;
      const resolvedPaneId =
        ownerPaneId ??
        (axisId === "right" || axisId === "volume" ? "pane-main" : null) ??
        (explicitPaneId && validPaneIds.has(explicitPaneId)
          ? explicitPaneId
          : null);

      if (!resolvedPaneId) continue;
      axis.paneId = resolvedPaneId;
      nextAxes.push(axis);
      if (axisId) seenAxisIds.add(axisId);
    }

    root.yAxis!.axes = nextAxes;
    return config;
  }

  export function dataLength(state: State, xAxisId?: string): number {
    const all = Object.values(state.objects)
      .filter((object): object is SeriesObject => object.kind === "series")
      .map((object) => {
        const series = object.series;
        const sharedData = object.dataRef
          ? state.dataSeries?.[object.dataRef]
          : undefined;
        if (series.data.length === 0 && sharedData) {
          return { ...series, data: sharedData.data };
        }
        return series;
      })
      .filter((series) => !xAxisId || Series.getXAxisId(series) === xAxisId);
    if (all.length === 0) return 0;
    return Math.max(...all.map((s) => s.data.length));
  }

  export function seriesInOrder(state: State): Series.State[] {
    const result: Series.State[] = [];
    const seen = new Set<string>();
    for (const pane of state.panes) {
      for (const objectId of pane.objectIds ?? []) {
        const object = state.objects[objectId] as
          | {
              kind?: string;
              seriesId?: string;
              series?: Series.State;
              dataRef?: string;
            }
          | undefined;
        if (object?.kind !== "series" || !object.seriesId || !object.series)
          continue;
        if (seen.has(object.seriesId)) continue;
        seen.add(object.seriesId);
        const sharedData = object.dataRef
          ? state.dataSeries?.[object.dataRef]
          : undefined;
        if (object.series.data.length === 0 && sharedData) {
          result.push({
            ...object.series,
            data: sharedData.data,
          });
        } else {
          result.push(object.series);
        }
      }
    }
    return result;
  }

  export type LayoutDimensions = {
    leftAxisWidth: number;
    rightAxisWidth: number;
    timeAxisHeight: number;
    eventStripHeight: number;
    areaX: number;
    areaWidth: number;
    areaHeight: number;
  };

  export function computeLayout(config: ChartConfig.Full): LayoutDimensions {
    const axes = config.yAxis.axes as Axis[];
    const countsByPane = new Map<string, { left: number; right: number }>();
    for (const axis of axes) {
      if (!axis.visible || axis.fixed === false) continue;
      const paneId = axis.paneId ?? "pane-main";
      const current = countsByPane.get(paneId) ?? { left: 0, right: 0 };
      if (axis.side === "left") current.left += 1;
      else current.right += 1;
      countsByPane.set(paneId, current);
    }
    const leftAxisCount = Math.max(
      0,
      ...Array.from(countsByPane.values()).map((value) => value.left),
    );
    const rightAxisCount = Math.max(
      0,
      ...Array.from(countsByPane.values()).map((value) => value.right),
    );
    const leftAxisWidth = leftAxisCount * config.yAxis.width;
    const rightAxisWidth = rightAxisCount * config.yAxis.width;
    const timeAxisHeight = config.xAxis.visible ? config.xAxis.height : 0;
    const eventStripHeight = 0;
    const { width, height } = config.chart.dimensions;
    return {
      leftAxisWidth,
      rightAxisWidth,
      timeAxisHeight,
      eventStripHeight,
      areaX: leftAxisWidth,
      areaWidth: width - leftAxisWidth - rightAxisWidth,
      areaHeight: Math.max(1, height - timeAxisHeight),
    };
  }

  export function buildTimeScale(config: ChartConfig.Full): TimeScale.State {
    const axes = (config.xAxis.axes as XAxis[] | undefined) ?? [];
    const activeAxis =
      axes.find((axis) => axis.id === config.xAxis.activeId) ?? axes[0];
    const spacing = activeAxis?.spacing ?? {
      barSpacing: 6,
      minBarSpacing: 0.5,
      maxBarSpacing: 50,
      rightOffset: 0,
    };
    const { edges, timeDisplay, style, visible } = config.xAxis;
    return TimeScale.State.parse({
      visible,
      barSpacing: spacing.barSpacing,
      minBarSpacing: spacing.minBarSpacing,
      maxBarSpacing: spacing.maxBarSpacing,
      rightOffset: spacing.rightOffset,
      fixLeftEdge: edges.fixLeftEdge,
      fixRightEdge: edges.fixRightEdge,
      borderVisible: style.borderVisible,
      borderColor: style.borderColor,
      ticksVisible: style.ticksVisible,
      timeVisible: timeDisplay.timeVisible,
      secondsVisible: timeDisplay.secondsVisible,
      width: config.chart.dimensions.width,
    });
  }

  export function buildAreaTimeScale(
    config: ChartConfig.Full,
  ): TimeScale.State {
    const layout = computeLayout(config);
    const axes = (config.xAxis.axes as XAxis[] | undefined) ?? [];
    const activeAxis =
      axes.find((axis) => axis.id === config.xAxis.activeId) ?? axes[0];
    const spacing = activeAxis?.spacing ?? {
      barSpacing: 6,
      minBarSpacing: 0.5,
      maxBarSpacing: 50,
      rightOffset: 0,
    };
    const { edges, timeDisplay, style, visible } = config.xAxis;
    return TimeScale.State.parse({
      visible,
      barSpacing: spacing.barSpacing,
      minBarSpacing: spacing.minBarSpacing,
      maxBarSpacing: spacing.maxBarSpacing,
      rightOffset: spacing.rightOffset,
      fixLeftEdge: edges.fixLeftEdge,
      fixRightEdge: edges.fixRightEdge,
      borderVisible: style.borderVisible,
      borderColor: style.borderColor,
      ticksVisible: style.ticksVisible,
      timeVisible: timeDisplay.timeVisible,
      secondsVisible: timeDisplay.secondsVisible,
      width: layout.areaWidth,
    });
  }
}
