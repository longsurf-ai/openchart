// Purpose: Resize an entire shared grid line with pointer capture or the keyboard.
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- Focusable separators implement the WAI-ARIA window splitter pattern. */
import { useEffect, useRef, useState, type RefObject } from "react";

import {
  resizeGridTracks,
  type GridRatios,
} from "@openchart/app/features/chart/utils/grid-layout";

/** The grid renders previews; its owner persists only committed gestures. */
export interface SharedDividersProps {
  readonly ratios: GridRatios;
  readonly container: RefObject<HTMLDivElement>;
  readonly minCellWidth: number;
  readonly minCellHeight: number;
  readonly onPreview: (ratios: GridRatios | null) => void;
  readonly onCommit: (ratios: GridRatios) => void;
}

interface Drag {
  pointerId: number;
  element: HTMLDivElement;
  axis: keyof GridRatios;
  index: number;
  coordinate: number;
  extent: number;
  minimum: number;
  initial: GridRatios;
  next: GridRatios;
}

/** Pointer moves produce one preview per animation frame, never a storage write. */
export function SharedDividers({
  ratios,
  container,
  minCellWidth,
  minCellHeight,
  onPreview,
  onCommit,
}: SharedDividersProps) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      drag.current = null;
    },
    [],
  );

  function finish(commit: boolean) {
    const gesture = drag.current;
    if (!gesture) return;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setActive(null);
    if (commit && gesture.next !== gesture.initial) onCommit(gesture.next);
    onPreview(null);
    if (gesture.element.hasPointerCapture(gesture.pointerId)) {
      gesture.element.releasePointerCapture(gesture.pointerId);
    }
  }

  function move(coordinate: number) {
    const gesture = drag.current;
    if (!gesture) return;
    gesture.next = resizeGridTracks(
      gesture.initial,
      gesture.axis,
      gesture.index,
      coordinate - gesture.coordinate,
      gesture.extent,
      gesture.minimum,
    );
  }

  return (
    <>
      {(["columns", "rows"] as const).flatMap((axis) => {
        const tracks = ratios[axis];
        const vertical = axis === "columns";
        let position = 0;
        return tracks.slice(0, -1).map((value, index) => {
          position += value;
          const id = `${axis}-${index}`;
          const before = position - value;
          const after = position + tracks[index + 1]!;
          return (
            <div
              key={id}
              role="separator"
              tabIndex={0}
              aria-label={`Resize ${axis} ${index + 1} and ${index + 2}`}
              aria-orientation={vertical ? "vertical" : "horizontal"}
              aria-valuenow={Math.round(position * 100)}
              aria-valuemin={Math.round(before * 100)}
              aria-valuemax={Math.round(after * 100)}
              aria-valuetext={`${Math.round(position * 100)} percent`}
              className="chart-grid-divider"
              data-axis={axis}
              data-dragging={active === id || undefined}
              style={
                vertical
                  ? { left: `${position * 100}%` }
                  : { top: `${position * 100}%` }
              }
              onPointerDown={(event) => {
                if (event.button !== 0 || drag.current) return;
                const rect = container.current!.getBoundingClientRect();
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {
                  pointerId: event.pointerId,
                  element: event.currentTarget,
                  axis,
                  index,
                  coordinate: vertical ? event.clientX : event.clientY,
                  extent: vertical ? rect.width : rect.height,
                  minimum: vertical ? minCellWidth : minCellHeight,
                  initial: ratios,
                  next: ratios,
                };
                setActive(id);
              }}
              onPointerMove={(event) => {
                if (drag.current?.pointerId !== event.pointerId) return;
                move(vertical ? event.clientX : event.clientY);
                if (frame.current !== null) return;
                frame.current = requestAnimationFrame(() => {
                  frame.current = null;
                  if (drag.current) onPreview(drag.current.next);
                });
              }}
              onPointerUp={(event) => {
                if (drag.current?.pointerId !== event.pointerId) return;
                move(vertical ? event.clientX : event.clientY);
                finish(true);
              }}
              onPointerCancel={(event) => {
                if (drag.current?.pointerId === event.pointerId) finish(false);
              }}
              onLostPointerCapture={(event) => {
                if (drag.current?.pointerId === event.pointerId) finish(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && drag.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  finish(false);
                  return;
                }
                if (drag.current) return;
                const negative = vertical ? "ArrowLeft" : "ArrowUp";
                const positive = vertical ? "ArrowRight" : "ArrowDown";
                if (![negative, positive, "Home", "End"].includes(event.key))
                  return;
                event.preventDefault();
                event.stopPropagation();
                const rect = container.current!.getBoundingClientRect();
                const extent = vertical ? rect.width : rect.height;
                const step = event.shiftKey ? 50 : 10;
                const delta =
                  event.key === "Home"
                    ? -extent
                    : event.key === "End"
                      ? extent
                      : event.key === negative
                        ? -step
                        : step;
                const next = resizeGridTracks(
                  ratios,
                  axis,
                  index,
                  delta,
                  extent,
                  vertical ? minCellWidth : minCellHeight,
                );
                if (next !== ratios) onCommit(next);
              }}
            />
          );
        });
      })}
    </>
  );
}
