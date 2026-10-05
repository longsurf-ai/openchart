// Purpose: Barrel export for headless rendering module
// Module:  @openchart/chart-core / headless

export { renderToBuffer, type HeadlessRenderOptions } from "./render";
export type { RenderProfileEvent } from "@openchart/chart-core/v2/paint";
export {
  assembleChartState,
  type ChartSpec,
  type IndicatorSpec,
  type SeriesData,
  type IndicatorData,
} from "./state-builder";
