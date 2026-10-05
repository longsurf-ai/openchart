// Purpose: Public attribute lookup through the drawing-kind registry
// Module:  @openchart/chart-core / drawing

import type { Drawing } from "./types";
import type { DrawingAttributeSchema } from "./shared";
import { DRAWING_REGISTRY } from "./registry";

export type {
  AttributeKey,
  ToolbarSchema,
  ModalTabName,
  ModalSchema,
  DrawingAttributeSchema,
} from "./shared";

/** Returns the attributes declared by a drawing kind.
 * @example attributesForType("trend_line");
 */
export function attributesForType(type: Drawing.Type): DrawingAttributeSchema {
  return DRAWING_REGISTRY[type].attributes;
}
