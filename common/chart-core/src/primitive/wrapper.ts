// Purpose: Lifecycle and rendering manager for series and pane primitives (attach, detach, update, z-order sorted rendering).
// Module:  @openchart/chart-core / primitive

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Primitive } from "./def";
import type { HitTest } from "@openchart/chart-core/hit";

export namespace PrimitiveWrapper {
  // Wrapper for managing series primitives
  export type SeriesState = {
    primitives: Map<string, Primitive.SeriesPrimitive>;
    attached: boolean;
    owners: Map<string, readonly string[]>;
    pendingAttachments: Set<string>;
    context?: Primitive.DrawContext;
  };

  // Create wrapper state
  export function create(): SeriesState {
    return {
      primitives: new Map(),
      attached: false,
      owners: new Map(),
      pendingAttachments: new Set(),
    };
  }

  // Attach a primitive to series
  export function attach<T>(
    state: SeriesState,
    primitive: Primitive.SeriesPrimitive<T>,
    context: Primitive.DrawContext,
  ): void {
    if (state.primitives.has(primitive.id)) {
      detach(state, primitive.id);
    }

    state.primitives.set(primitive.id, primitive as Primitive.SeriesPrimitive);
    primitive.attached?.(context);
  }

  // Detach a primitive from series
  export function detach(state: SeriesState, id: string): boolean {
    const p = state.primitives.get(id);
    if (!p) return false;

    p.detached?.();
    state.primitives.delete(id);
    state.pendingAttachments.delete(id);
    return true;
  }

  // Detach all primitives
  export function detachAll(state: SeriesState): void {
    for (const p of state.primitives.values()) {
      p.detached?.();
    }
    state.primitives.clear();
    state.owners.clear();
    state.pendingAttachments.clear();
    state.context = undefined;
  }

  /** Replace only one source's contribution; sibling indicator primitives survive.
   * @example PrimitiveWrapper.replaceOwned(state, indicatorId, nextPrimitives);
   */
  export function replaceOwned(
    state: SeriesState,
    owner: string,
    primitives: readonly Primitive.SeriesPrimitive[],
  ): void {
    const previous = new Set(state.owners.get(owner) ?? []);
    const incoming = new Set<string>();
    for (const primitive of primitives) {
      if (
        incoming.has(primitive.id) ||
        (state.primitives.has(primitive.id) && !previous.has(primitive.id))
      )
        throw new Error(
          `Primitive id “${primitive.id}” is already owned by another contribution.`,
        );
      incoming.add(primitive.id);
    }
    for (const id of previous) detach(state, id);
    state.owners.delete(owner);
    if (!primitives.length) return;
    state.owners.set(owner, [...incoming]);
    for (const primitive of primitives) {
      state.primitives.set(primitive.id, primitive);
      state.pendingAttachments.add(primitive.id);
    }
  }

  /** Hits use geometry produced by the most recent paint. @example hit(state, x, y) */
  export function hit(
    state: SeriesState,
    x: number,
    y: number,
  ): HitTest.Result | null {
    if (!state.context) return null;
    const bounds = state.context.coord.bounds;
    if (
      x < bounds.x ||
      x > bounds.x + bounds.width ||
      y < bounds.y ||
      y > bounds.y + bounds.height
    )
      return null;
    let result: HitTest.Result | null = null;
    for (const primitive of state.primitives.values()) {
      const candidate = primitive.hitTest?.(x, y, state.context);
      if (
        candidate &&
        (!result ||
          candidate.zOrder > result.zOrder ||
          (candidate.zOrder === result.zOrder &&
            candidate.distance < result.distance))
      )
        result = candidate;
    }
    return result;
  }

  // Get primitive by ID
  export function get(
    state: SeriesState,
    id: string,
  ): Primitive.SeriesPrimitive | undefined {
    return state.primitives.get(id);
  }

  // Get all primitives
  export function all(state: SeriesState): Primitive.SeriesPrimitive[] {
    return Array.from(state.primitives.values());
  }

  // Update all primitives with new context
  export function update<T>(
    state: SeriesState,
    context: Primitive.DrawContext,
    data: Primitive.DataContext<T>,
  ): void {
    state.context = context;
    for (const p of state.primitives.values()) {
      const typed = p as Primitive.SeriesPrimitive<T>;
      if (state.pendingAttachments.delete(p.id)) typed.attached?.(context);
      typed.updateAllViews?.(context, data);
    }
  }

  // Notify data change
  export function dataChanged<T>(
    state: SeriesState,
    context: Primitive.DataContext<T>,
  ): void {
    for (const p of state.primitives.values()) {
      const typed = p as Primitive.SeriesPrimitive<T>;
      typed.dataUpdated?.(context);
    }
  }

  // Collect all pane views sorted by z-order
  export function views(state: SeriesState): Primitive.PaneView[] {
    const result: Primitive.PaneView[] = [];

    for (const p of state.primitives.values()) {
      result.push(...p.paneViews());
    }

    return result.sort(
      (a, b) =>
        Primitive.zOrderValue[a.zOrder()] - Primitive.zOrderValue[b.zOrder()],
    );
  }

  // Render all primitives by z-order layer
  export function render(
    state: SeriesState,
    ctx: CanvasRenderingContext2D,
    layer: "background" | "normal" | "top",
  ): void {
    const paneViews = views(state);

    for (const v of paneViews) {
      if (v.zOrder() !== layer) continue;

      const r = v.renderer();
      if (!r) continue;

      if (layer === "background" && r.drawBackground) {
        r.drawBackground(ctx);
      }
      r.draw(ctx);
    }
  }

  // Wrapper for managing pane primitives
  export type PaneState = {
    primitives: Map<string, Primitive.PanePrimitive>;
  };

  export function createPane(): PaneState {
    return { primitives: new Map() };
  }

  export function attachPane(
    state: PaneState,
    primitive: Primitive.PanePrimitive,
    context: Primitive.DrawContext,
  ): void {
    if (state.primitives.has(primitive.id)) {
      detachPane(state, primitive.id);
    }

    state.primitives.set(primitive.id, primitive);
    primitive.attached?.(context);
  }

  export function detachPane(state: PaneState, id: string): boolean {
    const p = state.primitives.get(id);
    if (!p) return false;

    p.detached?.();
    state.primitives.delete(id);
    return true;
  }

  export function paneViews(state: PaneState): Primitive.PaneView[] {
    const result: Primitive.PaneView[] = [];

    for (const p of state.primitives.values()) {
      result.push(...p.paneViews());
    }

    return result.sort(
      (a, b) =>
        Primitive.zOrderValue[a.zOrder()] - Primitive.zOrderValue[b.zOrder()],
    );
  }
}
