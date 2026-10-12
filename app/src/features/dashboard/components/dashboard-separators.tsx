// Purpose: Resize adjacent Dashboard placements from their shared gap, using the grid's pixel geometry.
import { useRef } from "react";
import type { Layout } from "react-grid-layout";
import { calcGridItemPosition } from "react-grid-layout/core";

import {
  resizeSharedBoundary,
  sharedBoundaries,
  sharedBoundaryLimits,
  type SharedBoundary,
} from "../utils/shared-boundaries";
import { dashboardRows } from "../utils/layout";
import { cn } from "@openchart/app/utils/cn";

/**
 * Overlay shared-edge controls without adding RGL children. Pointer gestures capture
 * their starting layout, preview integer grid steps and commit once on release;
 * cancellation restores that layout. Arrow keys commit one step. The owner supplies
 * revision capture, persistence and write-error recovery; this component creates no
 * data and does not await writes. Lost capture cancels; the owner also cancels when
 * switching to its narrow layout. There are no global event listeners to clean up.
 * @example
 * ```tsx
 * import { useState } from "react";
 * import type { Layout } from "react-grid-layout";
 *
 * function Example() {
 *   const [layout, setLayout] = useState<Layout>([
 *     { i: "left", x: 0, y: 0, w: 6, h: 24 },
 *     { i: "right", x: 6, y: 0, w: 6, h: 24 },
 *   ]);
 *   return <DashboardSeparators layout={layout} width={1200} rowHeight={24}
 *     disabled={false} onStart={() => {}} onPreview={setLayout}
 *     onCommit={setLayout} onCancel={() => {}} />;
 * }
 * ```
 */
export function DashboardSeparators({
  layout,
  width,
  rowHeight,
  disabled,
  onStart,
  onPreview,
  onCommit,
  onCancel,
}: {
  layout: Layout;
  width: number;
  rowHeight: number;
  disabled: boolean;
  onStart: () => void;
  onPreview: (layout: Layout) => void;
  onCommit: (layout: Layout) => void;
  onCancel: () => void;
}) {
  const gesture = useRef<{
    pointerId: number;
    boundary: SharedBoundary;
    layout: Layout;
    origin: number;
    step: number;
    next: Layout;
    delta: number;
  }>();
  const params = {
    cols: 12,
    containerWidth: width,
    rowHeight,
    margin: [8, 8] as [number, number],
    containerPadding: [0, 0] as [number, number],
    maxRows: dashboardRows,
  };
  return sharedBoundaries(layout).map((boundary) => {
    const before = layout.find((item) => item.i === boundary.before)!;
    const after = layout.find((item) => item.i === boundary.after)!;
    const vertical = boundary.orientation === "vertical";
    const rect = calcGridItemPosition(
      params,
      before.x,
      before.y,
      before.w,
      before.h,
    );
    const position = vertical ? "x" : "y";
    const value = after[position];
    const limits = sharedBoundaryLimits(before, after, boundary.orientation);
    const minimum = value + limits.min;
    const maximum = value + limits.max;
    const unavailable = disabled || minimum >= maximum;
    const cancel = () => {
      const active = gesture.current;
      if (!active) return;
      gesture.current = undefined;
      onPreview(active.layout);
      onCancel();
    };
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- A focusable ARIA window splitter uses the separator role.
      <div
        key={`${boundary.before}:${boundary.after}`}
        role="separator"
        tabIndex={unavailable ? -1 : 0}
        aria-label={`Resize adjacent widgets ${vertical ? "horizontally" : "vertically"}`}
        aria-orientation={boundary.orientation}
        aria-controls={`${boundary.before} ${boundary.after}`}
        aria-valuemin={minimum}
        aria-valuemax={maximum}
        aria-valuenow={value}
        aria-disabled={unavailable}
        className={cn(
          "dashboard-separator absolute z-[11] touch-none outline-none aria-disabled:pointer-events-none",
          vertical
            ? "w-3 -translate-x-1/2 cursor-ew-resize"
            : "h-3 -translate-y-1/2 cursor-ns-resize",
        )}
        style={
          vertical
            ? {
                left: rect.left + rect.width + 4,
                top: rect.top,
                height: rect.height,
              }
            : {
                left: rect.left,
                top: rect.top + rect.height + 4,
                width: rect.width,
              }
        }
        onPointerDown={(event) => {
          if (unavailable || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          onStart();
          gesture.current = {
            pointerId: event.pointerId,
            boundary,
            layout,
            origin: vertical ? event.clientX : event.clientY,
            step: vertical ? (width + 8) / 12 : rowHeight + 8,
            next: layout,
            delta: 0,
          };
        }}
        onPointerMove={(event) => {
          const active = gesture.current;
          if (!active || active.pointerId !== event.pointerId) return;
          const coordinate =
            active.boundary.orientation === "vertical"
              ? event.clientX
              : event.clientY;
          const delta = Math.round((coordinate - active.origin) / active.step);
          if (delta === active.delta) return;
          active.delta = delta;
          active.next = resizeSharedBoundary(
            active.layout,
            active.boundary,
            delta,
          );
          onPreview(active.next);
        }}
        onPointerUp={(event) => {
          const active = gesture.current;
          if (!active || active.pointerId !== event.pointerId) return;
          gesture.current = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId);
          onCommit(active.next);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(event) => {
          if (unavailable) return;
          if (event.key === "Escape") {
            cancel();
            return;
          }
          if (gesture.current) return;
          const negative = vertical ? "ArrowLeft" : "ArrowUp";
          const positive = vertical ? "ArrowRight" : "ArrowDown";
          if (event.key !== negative && event.key !== positive) return;
          event.preventDefault();
          const next = resizeSharedBoundary(
            layout,
            boundary,
            event.key === positive ? 1 : -1,
          );
          onStart();
          onPreview(next);
          onCommit(next);
        }}
      />
    );
  });
}
