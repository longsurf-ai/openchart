// Purpose: Project a persisted annotation drawing into the shared automatic annotation layout.
import type { Drawing } from "@openchart/chart-core/drawing/types";
import { ChartAnnotation } from "./types";

/** Derive render inputs without inventing an Event or storing layout geometry.
 * @example const annotation = annotationFromDrawing(item);
 */
export function annotationFromDrawing(
  item: Drawing.AnnotationItem,
): ChartAnnotation.Renderable {
  return {
    id: item.id,
    label: item.title,
    sentiment: item.sentiment,
    priorityScore: 0,
    anchor: { start: item.time, labelAnchor: item.labelAnchor },
    style: {
      ...item.style,
      fillColor: item.style.fillColor ?? ChartAnnotation.DEFAULT_FILL_COLOR,
    },
    visibility: item.hidden ? "hidden" : "visible",
    content: { title: item.title, content: item.body, questions: [] },
    sourceBadges: item.sources.map((source) => ({
      id: source.url,
      label: source.title,
    })),
  };
}
