// Purpose: V2 API entry point — re-exports state-based architecture (renderer, state utils, x-scale, series fields)
// Module:  @openchart/chart-core / v2

/**
 * OpenChart v2 API
 *
 * State-based architecture where the consumer owns Chart.State
 * and the renderer is a pure function of that state.
 *
 * @example
 * ```typescript
 * import { v2 } from "@openchart/chart-core"
 *
 * const state = v2.createState({ config: { ... } })
 * const renderer = v2.createRenderer({
 *   container,
 *   getState: () => state,
 *   setState: (mutator) => { mutator(state) }
 * })
 *
 * renderer.render()
 * ```
 */

// Renderer API
export {
  createRenderer,
  type ChartRenderer,
  type RendererConfig,
  type RenderProfileEvent,
} from "./api";

// State utilities (pure functions)
export { ChartStateUtils } from "./state";
export { ChartStateModel } from "./state";
export { ChartPaneLayout } from "./state";
export { createState, createSeriesState } from "./state";
export * as XScale from "./x-scale";
export * as SeriesFields from "@openchart/chart-core/v2/series/fields";
export * as ScaleModeUtils from "@openchart/chart-core/v2/scale-mode";

// Re-export types needed by consumers
export type { Chart } from "@openchart/chart-core/chart/state";
export type { Series } from "@openchart/chart-core/series";
export type { ChartConfig } from "@openchart/chart-core/config";
export type { Invalidate } from "@openchart/chart-core/invalidate";
