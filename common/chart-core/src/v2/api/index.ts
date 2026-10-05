// Purpose: Public barrel export for the v2 api surface — re-exports renderer and event setup
// Module:  @openchart/chart-core / v2 / api

export {
  createRenderer,
  type ChartRenderer,
  type RendererConfig,
  type RenderProfileEvent,
} from "./renderer";
export { setupEvents, type EventsConfig } from "./events";
