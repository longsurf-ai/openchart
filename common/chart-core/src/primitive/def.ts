// Purpose: Core type definitions for the primitive system (PaneRenderer, PaneView, SeriesPrimitive, PanePrimitive) and convenience factories.
// Module:  @openchart/chart-core / primitive

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { CoordSys } from "@openchart/chart-core/coord";
import { HitTest } from "@openchart/chart-core/hit";

export namespace Primitive {
  // Z-order levels for rendering
  export const ZOrder = z.enum(["background", "normal", "top"]);
  export type ZOrder = z.infer<typeof ZOrder>;

  export const zOrderValue: Record<ZOrder, number> = {
    background: -1,
    normal: 0,
    top: 1,
  };

  // Renderer that draws to a pane
  export interface PaneRenderer {
    draw(ctx: CanvasRenderingContext2D): void;
    drawBackground?(ctx: CanvasRenderingContext2D): void;
  }

  // View that provides renderers for a pane
  export interface PaneView {
    zOrder(): ZOrder;
    renderer(): PaneRenderer | null;
  }

  // Context passed to primitives for drawing
  export type DrawContext = {
    chartId: string;
    seriesId?: string;
    paneIndex: number;
    coord: CoordSys.State;
    width: number;
    height: number;
    barWidth: number;
    xPositions: number[];
    /** Unshifted logical-axis position, including future projection space. */
    xPositionAt?: (index: number) => number;
    /** Frame-local shared text occupancy; keeps labels from every output legible. */
    labelPlacements?: CoordSys.Bounds[];
    /** Tests actual visible series ink; excludes grid and soft background fills. */
    labelIntersectsSeries?: (rect: CoordSys.Bounds) => boolean;
  };

  // Context for data access
  export type DataContext<T = unknown> = {
    data: T[];
    visibleRange: { from: number; to: number };
  };

  // Series-attached primitive (e.g., markers, price lines)
  export interface SeriesPrimitive<T = unknown> {
    id: string;
    zOrder: ZOrder;

    // Lifecycle hooks
    attached?(context: DrawContext): void;
    detached?(): void;

    // Called when series data changes
    dataUpdated?(context: DataContext<T>): void;

    // Called before each repaint
    updateAllViews?(context: DrawContext, data: DataContext<T>): void;

    // Get pane views for this primitive
    paneViews(): PaneView[];

    // Optional hit testing
    hitTest?(x: number, y: number, context: DrawContext): HitTest.Result | null;

    // Request repaint
    requestUpdate?(): void;
  }

  // Chart-wide primitive (e.g., watermark)
  export interface PanePrimitive {
    id: string;
    zOrder: ZOrder;
    paneIndex: number;

    attached?(context: DrawContext): void;
    detached?(): void;

    updateAllViews?(context: DrawContext): void;

    paneViews(): PaneView[];

    hitTest?(x: number, y: number, context: DrawContext): HitTest.Result | null;
  }

  // Factory for creating primitives
  export type Factory<T, O> = (options: O) => T;

  // Simple renderer that just draws
  export function renderer(
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): PaneRenderer {
    return { draw };
  }

  // Create a pane view with fixed z-order
  export function view(order: ZOrder, r: PaneRenderer | null): PaneView {
    return {
      zOrder: () => order,
      renderer: () => r,
    };
  }

  // Create a series primitive with minimal boilerplate
  export function series<T>(
    id: string,
    order: ZOrder,
    render: (
      ctx: CanvasRenderingContext2D,
      context: DrawContext,
      data: DataContext<T>,
    ) => void,
  ): SeriesPrimitive<T> {
    let current: { context: DrawContext; data: DataContext<T> } | null = null;

    return {
      id,
      zOrder: order,

      updateAllViews(context, data) {
        current = { context, data };
      },

      paneViews() {
        if (!current) return [];
        const c = current;
        return [
          view(
            order,
            renderer((ctx) => render(ctx, c.context, c.data)),
          ),
        ];
      },
    };
  }

  // Create a pane primitive with minimal boilerplate
  export function pane(
    id: string,
    order: ZOrder,
    paneIndex: number,
    render: (ctx: CanvasRenderingContext2D, context: DrawContext) => void,
  ): PanePrimitive {
    let current: DrawContext | null = null;

    return {
      id,
      zOrder: order,
      paneIndex,

      updateAllViews(context) {
        current = context;
      },

      paneViews() {
        if (!current) return [];
        const c = current;
        return [
          view(
            order,
            renderer((ctx) => render(ctx, c)),
          ),
        ];
      },
    };
  }
}
