// Purpose: Public barrel — re-exports repaint() and RuntimeState for the paint module.
// Module:  @openchart/chart-core / v2 / paint

export { repaint, type RuntimeState } from "./paint";
export {
  createRenderProfileFrame,
  type RenderProfileEvent,
  type RenderProfileFrame,
  type RenderProfileMetadata,
  type RenderProfileStage,
} from "./profile";
