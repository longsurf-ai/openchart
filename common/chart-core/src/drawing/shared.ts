// Purpose: Shared drawing contracts and attribute vocabulary; no kind implementations
// Module:  @openchart/chart-core / drawing

import type { CoordSys } from "@openchart/chart-core/coord";
import type { Drawing } from "./types";
import type { ResolvedBoundaryPrimitive } from "./boundary";

export type AttributeKey =
  | "name"
  | "stroke"
  | "fill"
  | "width"
  | "lineStyle"
  | "fontColor"
  | "fontSize"
  | "text"
  | "startCap"
  | "endCap"
  | "extend"
  | "middlePoint"
  | "priceLabels"
  | "opacity";

export type ToolbarSchema = AttributeKey[];

export type ModalTabName = "Style" | "Text";

export type ModalSchema = Record<ModalTabName, AttributeKey[]>;

export interface DrawingAttributeSchema {
  toolbar: ToolbarSchema;
  modal: ModalSchema;
}

export const BASIC_LINE_STYLE: AttributeKey[] = [
  "stroke",
  "width",
  "lineStyle",
];

export const ATTACHED_TEXT_STYLE: AttributeKey[] = [
  "text",
  "fontColor",
  "fontSize",
];

export type DrawingOverlayLabel = {
  y: number;
  price: number;
  color: string;
  axisId: string;
};

export type RenderContext = {
  backgroundColor?: string;
  coord: CoordSys.State;
  xPositions: number[];
  xFn: (index: number) => number;
  data: unknown[];
  visibleRange: { from: number; to: number };
  area: { x: number; y: number; width: number; height: number };
};

export type Point = { x: number; y: number };

/** Canvas-local label centre and readable screen angle in degrees. */
export type LineLabelPlacement = Point & {
  angle: number;
  /** Paint-owned finite branch for hover selection; stripped by the public lookup. */
  boundary?: { primitive: ResolvedBoundaryPrimitive; from: number; to: number };
};

/** Pixel-space input shared by all drawing hit tests. */
export type HitContext = RenderContext & { mouse: Point };

/** Stateless attributes, body rendering, and body hit testing for one drawing kind.
 * The render/hit wrappers own projection, clipping, styles, ordering, and handles.
 */
export interface DrawingDefinition {
  attributes: DrawingAttributeSchema;
  render: (
    ctx: CanvasRenderingContext2D,
    item: Drawing.Item,
    points: Point[],
    context: RenderContext,
    isSelected: boolean,
    overlays: DrawingOverlayLabel[],
  ) => void;
  hitTest: (
    item: Drawing.Item,
    points: Point[],
    context: HitContext,
    canvas: CanvasRenderingContext2D,
  ) => { distance: number } | null;
}
