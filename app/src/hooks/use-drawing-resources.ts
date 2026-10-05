// Purpose: Project Query-owned drawings into one renderer and persist completed local edits.
import { v2, type Drawing } from "@openchart/chart-core";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";

import {
  drawingList,
  drawingMutation,
  drawingScopeKey,
  type DrawingEdit,
  type DrawingScope,
} from "@openchart/app/lib/chart/drawings";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/**
 * Key the consumer by drawingScopeKey and optional Drawing Resource ID.
 * Query owns saved/pending mutations; the renderer owns drafts and drag previews.
 * Unmount flushes edits to their
 * original scope and releases subscriptions, timers and projected drawings.
 * Read-only views project drawings locked and never record edits.
 * @example const drawings = useDrawingResources(chart, transport, scope);
 */
export function useDrawingResources(
  chart: ChartRuntime,
  transport: AppTransport,
  scope: DrawingScope,
  drawingId?: string,
  readOnly = false,
) {
  const client = useQueryClient();
  const options = drawingMutation(transport, client, scope);
  const query = useQuery(drawingList(transport, scope));
  const { mutate, mutateAsync } = useMutation(options);
  const unsettled = useMutationState({
    filters: {
      mutationKey: options.mutationKey,
      predicate: (mutation) =>
        mutation.state.status === "pending" ||
        mutation.state.status === "error",
    },
    select: (mutation) => mutation.state,
  });
  const buffered = useRef(new Map<string, DrawingEdit>());
  const projecting = useRef(false);
  const key = drawingScopeKey(scope);
  const rows = (query.data ?? []).filter(
    (row) =>
      drawingScopeKey(row) === key && (!drawingId || row.id === drawingId),
  );
  const itemId = drawingId ? rows[0]?.data.id : undefined;
  const hidden = drawingId ? rows[0]?.data.hidden : undefined;

  useLayoutEffect(() => {
    const release = () =>
      chart.mutate((state) => {
        for (const item of v2.ChartStateModel.drawingItems(state))
          v2.ChartStateModel.removeDrawingObject(state, item.id);
        delete state.drawings.draft;
      });
    // Without a subscription, nothing a read-only view projects can become an edit.
    if (readOnly) return release;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      if (!buffered.current.size) return;
      const edits = [...buffered.current.values()];
      buffered.current.clear();
      for (const edit of edits) mutate(edit);
    };
    const unsubscribe = chart.store.subscribe((state, previous) => {
      if (projecting.current || state.objects === previous.objects) return;
      const before = new Map(
        v2.ChartStateModel.drawingItems(previous).map((item) => [
          item.id,
          item,
        ]),
      );
      for (const item of v2.ChartStateModel.drawingItems(state)) {
        if (drawingId && item.id !== itemId) continue;
        if (before.get(item.id) !== item)
          buffered.current.set(item.id, {
            id: item.id,
            data: drawingId ? { ...item, hidden: hidden ?? false } : item,
            ...(drawingId ? { existingResourceId: drawingId } : {}),
          });
        before.delete(item.id);
      }
      if (!drawingId)
        for (const id of before.keys()) buffered.current.set(id, { id });
      if (buffered.current.size) {
        clearTimeout(timer);
        timer = setTimeout(flush, 200);
      }
    });
    // Core finishes its gesture in the same event; flush after its handler.
    const finish = () => queueMicrotask(flush);
    window.addEventListener("pointerup", finish);
    window.addEventListener("mouseup", finish);
    return () => {
      unsubscribe();
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("mouseup", finish);
      flush();
      release();
    };
  }, [chart, mutate, drawingId, itemId, hidden, readOnly]);

  useLayoutEffect(() => {
    if (!query.data) return;
    const items = new Map<string, Drawing.Item>(
      query.data
        .filter(
          (row) =>
            drawingScopeKey(row) === key &&
            (!drawingId || row.id === drawingId),
        )
        .map((row) => [row.data.id, row.data]),
    );
    // Retain unsaved edits during refetches and show the same pending geometry in sibling cells.
    const edits = [
      ...unsettled.map((state) => state.variables as DrawingEdit),
      ...buffered.current.values(),
    ];
    for (const edit of edits) {
      if (drawingId && edit.id !== itemId) continue;
      if (edit.data) items.set(edit.id, edit.data);
      else items.delete(edit.id);
    }
    projecting.current = true;
    try {
      chart.mutate((state) => {
        const existing = new Map(
          v2.ChartStateModel.drawingItems(state).map((item) => [item.id, item]),
        );
        for (const item of items.values()) {
          // A focused editor must show its target, without changing Dashboard visibility.
          // A read-only view locks every drawing so none can be selected or moved.
          const visible = drawingId
            ? { ...item, hidden: false }
            : readOnly
              ? { ...item, locked: true }
              : item;
          if (JSON.stringify(existing.get(item.id)) !== JSON.stringify(visible))
            v2.ChartStateModel.upsertDrawingObject(state, visible);
          existing.delete(item.id);
        }
        for (const id of existing.keys())
          v2.ChartStateModel.removeDrawingObject(state, id);
      });
    } finally {
      projecting.current = false;
    }
  }, [chart, key, query.data, unsettled, drawingId, itemId, readOnly]);

  const failed = unsettled.filter(
    (state) =>
      state.status === "error" &&
      (!drawingId || (state.variables as DrawingEdit).id === itemId),
  );
  return {
    error: query.error ?? failed[0]?.error,
    resourceIds: rows.map((row) => ({
      resourceId: row.id,
      itemId: row.data.id,
    })),
    /** Save the latest geometry after earlier queued edits, returning the Resource identity. */
    ensureSaved: async (id: string) => {
      if (drawingId && id !== itemId)
        throw new Error("This view can only update the linked drawing.");
      const data = v2.ChartStateModel.drawingItems(chart.store.getState()).find(
        (item) => item.id === id,
      );
      if (!data) throw new Error("This drawing was deleted.");
      buffered.current.delete(id);
      const saved = await mutateAsync({
        id,
        data: drawingId ? { ...data, hidden: hidden ?? false } : data,
        ...(drawingId ? { existingResourceId: drawingId } : {}),
      });
      if (!saved) throw new Error("Couldn’t save this drawing.");
      return saved;
    },
    retry: () => {
      if (!failed.length) return query.refetch();
      const edits = new Map(
        failed.map((state) => {
          const edit = state.variables as DrawingEdit;
          return [edit.id, edit];
        }),
      );
      for (const edit of edits.values()) mutate(edit);
    },
  };
}
