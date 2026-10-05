// Purpose: Adapt persisted placement rectangles to the existing grid layout library.
import { defineId } from "@openchart/identifier";
import {
  bottom,
  cloneLayout,
  getAllCollisions,
  getFirstCollision,
  getLayoutItem,
  modifyLayout,
  moveElement,
  verticalCompactor,
  type Layout,
  type LayoutItem,
} from "react-grid-layout/core";

import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";

type Placement = Dashboard["widgets"][number];

/** Logical rows in one desktop dashboard viewport; pixel height follows its container. */
export const dashboardRows = 24;

/** Attach display constraints without storing library-specific fields. @example const layout = widgetLayout(dashboard.widgets, registry); */
export function widgetLayout(
  widgets: Dashboard["widgets"],
  registry: Readonly<Record<string, WidgetDefinition | undefined>>,
): Layout {
  return widgets.map((widget) => ({
    i: widget.id,
    ...widget.layout,
    minW: registry[widget.kind]?.minSize.w ?? 1,
    minH: registry[widget.kind]?.minSize.h ?? 1,
  }));
}

/** Save every rectangle affected by a gesture, retaining persisted order and identity. @example const widgets = placeWidgets(dashboard.widgets, layout); */
export function placeWidgets(
  widgets: Dashboard["widgets"],
  layout: Layout,
): Dashboard["widgets"] {
  const positions = new Map(layout.map((item) => [item.i, item]));
  return widgets.map((widget) => {
    const next = positions.get(widget.id);
    if (!next) throw new Error(`Missing placement layout: ${widget.id}`);
    const { x, y, w, h } = next;
    return { ...widget, layout: { x, y, w, h } };
  });
}

/** Keyboard edits use the same collision and compaction algorithms as dragging. @example const next = editWidgetLayout(layout, id, rectangle); */
export function editWidgetLayout(
  layout: Layout,
  id: string,
  rectangle: Placement["layout"],
): Layout {
  const copy = cloneLayout(layout);
  const item = getLayoutItem(copy, id);
  if (!item) throw new Error("This widget no longer exists.");
  const h =
    rectangle.h === item.h
      ? item.h
      : Math.max(item.minH ?? 1, Math.min(rectangle.h, dashboardRows - item.y));
  const y = Math.max(0, Math.min(rectangle.y, dashboardRows - h));
  if (
    item.x === rectangle.x &&
    item.y === y &&
    item.w === rectangle.w &&
    item.h === h
  )
    return layout;
  const resized = modifyLayout(copy, {
    ...item,
    w: rectangle.w,
    h,
  });
  const target = getLayoutItem(resized, id)!;
  return verticalCompactor.compact(
    moveElement(
      resized,
      target,
      rectangle.x,
      y,
      true,
      false,
      "vertical",
      12,
      false,
    ),
    12,
  );
}

/** Append a placement using the shared layout rule, referencing a Resource when the widget has one; creates only a placement ID. @example const widgets = appendWidget(dashboard.widgets, definition, resourceId); */
export function appendWidget(
  widgets: Dashboard["widgets"],
  definition: Pick<WidgetDefinition, "kind" | "defaultSize">,
  resourceId?: string,
): Dashboard["widgets"] {
  const prepared = prepareWidgetLayout(widgets, definition.defaultSize);
  return [
    ...prepared.widgets,
    {
      id: defineId("wdg", "WidgetPlacement.ID").create(),
      kind: definition.kind,
      ...(resourceId === undefined ? {} : { resourceId }),
      layout: prepared.layout,
    },
  ];
}

/**
 * Dock a new placement on the anchor's right, side by side, never below. Planned on the
 * compacted layout the grid shows. A column is free when no other placement crosses the
 * anchor's rows in it; the anchor's free run is the widest free span around it. In order of
 * least disruption:
 * 1. free columns on the anchor's right fit the new widget's minimum size on the tallest band
 *    of the anchor's lowest rows (its full height first): it takes them all, under the
 *    placements above it, and nothing moves;
 * 2. the run's free columns fit it: the anchor keeps its width and slides to the run's left edge;
 * 3. the run fits both minimum widths: the run is split, the anchor keeping the larger half;
 * 4. otherwise a pair `max(A.w, A.minW + M.w)` wide pushes the siblings it covers down, and
 *    2-3 run again in the columns they vacated.
 * The pair is pinned on the anchor's rows, at least the new widget's minimum height tall (a
 * shorter anchor grows down with it and what it covers is pushed), then settles as the grid
 * compacts. Each half rises to the placements above its own columns and both end on the pair's
 * bottom. Cases 1-3 move nothing but the anchor unless that height pushes; the saved layout is
 * exactly what the compacting grid shows.
 * @example const { id, widgets } = placeWidgetBeside(dashboard.widgets, registry, anchorId, definition, resourceId);
 */
export function placeWidgetBeside(
  widgets: Dashboard["widgets"],
  registry: Readonly<Record<string, WidgetDefinition | undefined>>,
  anchorId: string,
  definition: Pick<WidgetDefinition, "kind" | "minSize">,
  resourceId?: string,
): { id: string; widgets: Dashboard["widgets"] } {
  const shown = verticalCompactor.compact(widgetLayout(widgets, registry), 12);
  const anchor = getLayoutItem(shown, anchorId);
  if (!anchor) throw new Error("This widget no longer exists.");
  const { minSize } = definition;
  // Pin the pair on the anchor's rows, pushing what it covers, then settle as the grid does.
  const pin = (layout: Layout, x: number, w: number) =>
    verticalCompactor.compact(
      verticalCompactor
        .compact(
          modifyLayout(layout, {
            ...anchor,
            x,
            w,
            h: Math.max(anchor.h, minSize.h),
            static: true,
          }),
          12,
        )
        .map((item) => ({ ...item, static: false })),
      12,
    );
  let layout = shown;
  const shelf = shelfWidth(layout, anchor, minSize);
  let pair = shelf
    ? { x: anchor.x, total: anchor.w + shelf, w: shelf }
    : pairColumns(layout, anchor, minSize.w);
  if (!pair) {
    const total = Math.max(anchor.w, (anchor.minW ?? 1) + minSize.w);
    layout = pin(layout, Math.min(anchor.x, 12 - total), total);
    // The pushed pair's columns are now free, so case 3 fits at least.
    pair = pairColumns(layout, anchor, minSize.w)!;
  }
  // A shelf's columns may not be free on the anchor's upper rows, so only the anchor is pinned.
  const settled = pin(layout, pair.x, pair.total - (shelf ?? 0));
  const { y, h } = getLayoutItem(settled, anchorId)!;
  const id = defineId("wdg", "WidgetPlacement.ID").create();
  // Each half rises to the placements above its own columns and ends on the pair's bottom.
  const half = (i: string, x: number, w: number) => {
    const top = bottom(
      getAllCollisions(settled, { i: anchorId, x, y: 0, w, h: y + h }),
    );
    return { i, x, y: top, w, h: y + h - top };
  };
  const anchorW = pair.total - pair.w;
  const docked = half(id, pair.x + anchorW, pair.w);
  return {
    id,
    widgets: placeWidgets(
      [
        ...widgets,
        {
          id,
          kind: definition.kind,
          ...(resourceId === undefined ? {} : { resourceId }),
          layout: docked,
        },
      ],
      [...modifyLayout(settled, half(anchorId, pair.x, anchorW)), docked],
    ),
  };
}

/** The anchor's free run of columns on rows `[top, anchor bottom)`. */
function freeRun(layout: Layout, anchor: LayoutItem, top: number) {
  const band = { ...anchor, y: top, h: anchor.y + anchor.h - top, w: 1 };
  const free = (x: number) =>
    x >= 0 && x < 12 && !getFirstCollision(layout, { ...band, x });
  let left = anchor.x;
  while (free(left - 1)) left--;
  let right = anchor.x + anchor.w;
  while (free(right)) right++;
  return { left, right };
}

/** The pair's left edge, total width and the new widget's width on its right, by cases 2-3 of {@link placeWidgetBeside}. */
function pairColumns(layout: Layout, anchor: LayoutItem, minW: number) {
  const anchorMinW = anchor.minW ?? 1;
  const { left, right } = freeRun(layout, anchor, anchor.y);
  const span = right - left;
  const freeRight = right - anchor.x - anchor.w;
  // Only an anchor shorter than the new widget's minimum height misses case 1 here; it stays put and grows down.
  if (freeRight >= minW)
    return { x: anchor.x, total: anchor.w + freeRight, w: freeRight };
  if (span - anchor.w >= minW)
    return { x: left, total: span, w: span - anchor.w };
  if (span >= anchorMinW + minW) {
    const w = Math.min(Math.max(Math.floor(span / 2), minW), span - anchorMinW);
    return { x: left, total: span, w };
  }
  return undefined;
}

/** Case 1 of {@link placeWidgetBeside}: the width of the free right columns on the tallest band of the anchor's lowest rows, its full height first, that fits the new widget. */
function shelfWidth(
  layout: Layout,
  anchor: LayoutItem,
  minSize: WidgetDefinition["minSize"],
) {
  const end = anchor.y + anchor.h;
  for (let top = anchor.y; top + minSize.h <= end; top++) {
    const w = freeRun(layout, anchor, top).right - anchor.x - anchor.w;
    if (w >= minSize.w) return w;
  }
  return undefined;
}

/** Fill the first viewport, split it for the second widget, then append without moving siblings.
 * Both existing placements and the new rectangle must be saved in one Dashboard mutation.
 * @example const { widgets, layout } = prepareWidgetLayout(dashboard.widgets, definition.defaultSize);
 */
export function prepareWidgetLayout(
  widgets: Dashboard["widgets"],
  size: WidgetDefinition["defaultSize"],
): { widgets: Dashboard["widgets"]; layout: Placement["layout"] } {
  if (widgets.length === 0)
    return { widgets, layout: { x: 0, y: 0, w: 12, h: dashboardRows } };
  if (widgets.length === 1)
    return {
      widgets: widgets.map((widget) => ({
        ...widget,
        layout: { x: 0, y: 0, w: 6, h: dashboardRows },
      })),
      layout: { x: 6, y: 0, w: 6, h: dashboardRows },
    };
  return {
    widgets,
    layout: {
      x: 0,
      y: Math.max(0, ...widgets.map(({ layout }) => layout.y + layout.h)),
      ...size,
    },
  };
}
