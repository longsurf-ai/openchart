// Purpose: Package entry point — re-exports all public API types and namespaces for @openchart/chart-core
// Module:  @openchart/chart-core

export { ChartConfig, ConfigRegistry } from "./config";
export type { ConfigTypes } from "./config";
export { Data } from "./data";
export {
  Chart,
  ChartId,
  ChartObjectId,
} from "@openchart/chart-core/chart/state";
export { Action, Effect, Mapping, Drag, Input } from "./interaction";
export { Invalidate } from "./invalidate";
export { TextCache, LabelCache } from "./cache";
export { HitTest } from "./hit";
export {
  Drawing,
  renderDrawings,
  hitTestDrawings,
  attributesForType,
} from "./drawing";
export type {
  AttributeKey,
  DrawingAttributeSchema,
  ModalSchema,
  ModalTabName,
  ToolbarSchema,
} from "./drawing";
export {
  Primitive,
  PrimitiveWrapper,
  PriceLine,
  Marker as PrimitiveMarker,
  Tag,
} from "./primitive";
export { Event } from "./event";
export { Span } from "./span";
export { ChartAnnotation } from "./annotation";
export { Marker } from "./marker";
export { Strategy, renderStrategyExecutions } from "./strategy";
export {
  VerticalProfile,
  layoutVerticalProfile,
  paintVerticalProfile,
} from "./vertical-profile";
export type { VerticalProfileGeometry } from "./vertical-profile";
export {
  RuntimeVolumeSeriesOptions,
  RuntimeVolumeYAxisOptions,
  Series,
  SeriesRegistry,
} from "./series";
export {
  LineSeries,
  AreaSeries,
  HistogramSeries,
  BarSeries,
  CandlestickSeries,
  BaselineSeries,
} from "./series";
export {
  YScale,
  TimeScale,
  Tick,
  PriceAxis,
  TimeAxis,
  ScaleMode,
  YAxisConfig,
} from "./scale";
export { Render, Draw } from "./render";
export { Bus, BusEvent, ChartEvent, SeriesEvent, TimeScaleEvent } from "./bus";
export { Live, LiveEvent, Resolution } from "./live";
export { Tz, fromUTC, offset } from "./tz";
export { fn, nominal, type Nominal, Color, UUID, Constants } from "./util";
export {
  CoordSys,
  CoordSysRegistry,
  createCartesian2D,
  createNone,
} from "./coord";
export { Easing, Kinetic, Animation } from "./animation";
export { Locale } from "./format";
export { GridLayout, Resize } from "./view";
export {
  canonicalJsonStringify,
  canonicalizeDashboardWorkspaceForDigest,
  digestDashboardWorkspace,
  isRuntimeDerivedVolumeAxisId,
  normalizeWorkspacePaneObjectIds,
  repairDashboardWorkspace,
  type WorkspaceRepairChange,
  type WorkspaceRepairResult,
} from "./workspace";
export {
  ControlPanel,
  ControlPanelConfig,
  ControlPanelEvent,
  type ControlPanelHandle,
} from "./control";
export type { DerivedContracts } from "@openchart/chart-core/derived/contracts";

// v2 API - state-based architecture (recommended)
export * as v2 from "./v2";

// Headless rendering lives at '@openchart/chart-core/headless' — a separate entry
// point that depends on @napi-rs/canvas (native binary).  It must NOT be
// re-exported here, because browser bundlers (Vite) would try to bundle the
// native .node file and fail.
