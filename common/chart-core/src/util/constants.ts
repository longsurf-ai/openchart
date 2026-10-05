// Purpose: Shared constants for chart layout and rendering (axis sizes, bar spacing, zoom limits, kinetic scrolling, font)
// Module:  @openchart/chart-core / util

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
/**
 * Shared constants for chart layout and rendering.
 * Consolidates all magic numbers into a single location.
 */
export namespace Constants {
  // Layout dimensions
  export const PRICE_AXIS_WIDTH = 60;
  export const TIME_AXIS_HEIGHT = 30;
  export const MIN_PANE_HEIGHT = 50;

  // Tick spacing
  export const TICK_SPACING = 50;
  export const MIN_TICK_MARKS = 3;
  export const MAX_TICK_MARKS = 8;

  // Bar spacing
  export const DEFAULT_BAR_SPACING = 6;
  export const MIN_BAR_SPACING = 0.5;
  export const MAX_BAR_SPACING = 50;

  // Scale margins (0-1 fractional values)
  export const DEFAULT_MARGIN_TOP = 0.1;
  export const DEFAULT_MARGIN_BOTTOM = 0.1;
  export const HISTOGRAM_MARGIN_BOTTOM = 0;

  // Extent padding (fraction of data range to add as padding)
  export const EXTENT_PADDING = 0.1;

  // Zoom limits
  export const MIN_ZOOM_FACTOR = 0.02;
  export const MAX_ZOOM_MARGIN = 0.98;
  export const ZOOM_DECAY = 0.97;

  // Kinetic scrolling
  export const KINETIC_SCROLL_MIN_SPEED = 0.2;
  export const KINETIC_SCROLL_MAX_SPEED = 7;
  export const KINETIC_SCROLL_DECAY = 0.95;
  export const KINETIC_SCROLL_MIN_MOVE = 15;

  // Crosshair
  export const DEFAULT_CROSSHAIR_LINE_WIDTH = 1;

  // Font
  export const DEFAULT_FONT_SIZE = 12;
  export const DEFAULT_FONT_FAMILY =
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
}
