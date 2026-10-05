// Purpose: Static, exhaustive drawing-kind definitions; no registration lifecycle
// Module:  @openchart/chart-core / drawing

import type { Drawing } from "./types";
import type { DrawingAttributeSchema, DrawingDefinition } from "./shared";
import { trendLine } from "@openchart/chart-core/drawing/kinds/trend-line";
import { ray } from "@openchart/chart-core/drawing/kinds/ray";
import { extendedLine } from "@openchart/chart-core/drawing/kinds/extended-line";
import { horizontalLine } from "@openchart/chart-core/drawing/kinds/horizontal-line";
import { horizontalRay } from "@openchart/chart-core/drawing/kinds/horizontal-ray";
import { verticalLine } from "@openchart/chart-core/drawing/kinds/vertical-line";
import { crossLine } from "@openchart/chart-core/drawing/kinds/cross-line";
import { parallelChannel } from "@openchart/chart-core/drawing/kinds/parallel-channel";
import { rectangle } from "@openchart/chart-core/drawing/kinds/rectangle";
import { ellipse } from "@openchart/chart-core/drawing/kinds/ellipse";
import { circle } from "@openchart/chart-core/drawing/kinds/circle";
import { triangle } from "@openchart/chart-core/drawing/kinds/triangle";
import { polyline } from "@openchart/chart-core/drawing/kinds/polyline";
import { curvedLine } from "@openchart/chart-core/drawing/kinds/curved-line";
import { freehand } from "@openchart/chart-core/drawing/kinds/freehand";
import { text } from "@openchart/chart-core/drawing/kinds/text";
import { fibRetracement } from "@openchart/chart-core/drawing/kinds/fib-retracement";
import { fibExtension } from "@openchart/chart-core/drawing/kinds/fib-extension";
import { fibChannel } from "@openchart/chart-core/drawing/kinds/fib-channel";
import { volumeProfile } from "@openchart/chart-core/drawing/kinds/volume-profile";

/** All canvas drawing kinds, checked against the persisted Drawing.Type vocabulary. */
export const DRAWING_REGISTRY: Record<
  Drawing.Type,
  | DrawingDefinition
  | {
      /** Batch paint and hit testing belong to the named overlay layer. */
      layer: "annotation" | "span";
      attributes: DrawingAttributeSchema;
    }
> = {
  annotation: {
    layer: "annotation",
    attributes: { toolbar: [], modal: { Style: [], Text: [] } },
  },
  agent_session: {
    layer: "span",
    attributes: { toolbar: [], modal: { Style: [], Text: [] } },
  },
  trend_line: trendLine,
  ray: ray,
  extended_line: extendedLine,
  horizontal_line: horizontalLine,
  horizontal_ray: horizontalRay,
  vertical_line: verticalLine,
  cross_line: crossLine,
  parallel_channel: parallelChannel,
  rectangle: rectangle,
  ellipse: ellipse,
  circle: circle,
  triangle: triangle,
  polyline: polyline,
  curved_line: curvedLine,
  freehand: freehand,
  text: text,
  fib_retracement: fibRetracement,
  fib_extension: fibExtension,
  fib_channel: fibChannel,
  volume_profile: volumeProfile,
};
