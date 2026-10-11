// Purpose: Adapt a Dashboard placement to one Watchlist and own its dialogs, switching, and lifecycle actions.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ListTree } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";

import { useWidget } from "@openchart/app/hooks/use-widget";
import { useStore } from "zustand";
import { BehaviorSubject } from "rxjs";
import type { Quotes } from "../hooks/use-quote";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";

import {
  createWatchlist,
  deleteWatchlist,
  watchlistList,
  watchlistDetail,
  watchlistMutation,
} from "../api/queries";
import {
  createWatchlistViewStore,
  type WatchlistViewStore,
} from "../stores/view";
import {
  addListing,
  addSection,
  renameSection,
  removeNode,
} from "../utils/tree";
import {
  WatchlistPlacementContext,
  WatchlistSymbolPicker,
  type WatchlistAction,
} from "./context";
import { WatchlistDialog } from "./watchlist-dialog";
import { WatchlistView } from "./watchlist-view";

function WatchlistPlacement({ children }: PropsWithChildren) {
  const { placementId, transport } = useWidget();
  const client = useQueryClient();
  const [view] = useState(() => createWatchlistViewStore(placementId));
  const watchlistId = useStore(view, (state) => state.selectedWatchlistId);
  const lists = useInfiniteQuery(watchlistList(transport));
  const selected = useQuery(watchlistDetail(transport, watchlistId));
  useEffect(() => {
    if (watchlistId !== undefined && selected.data !== null) return;
    // A saved choice can be on an unloaded page. Only a confirmed missing
    // detail clears it; Query's null entries also exclude deleted defaults.
    const next = lists.data?.find(
      (item) =>
        client.getQueryData(watchlistDetail(transport, item.id).queryKey) !==
        null,
    )?.id;
    if (next !== watchlistId) view.setState({ selectedWatchlistId: next });
  }, [watchlistId, selected.data, lists.data, client, transport, view]);
  return (
    <WatchlistSession
      key={watchlistId ?? "empty"}
      watchlistId={watchlistId}
      view={view}
    >
      {children}
    </WatchlistSession>
  );
}

function WatchlistSession({
  watchlistId,
  view,
  children,
}: {
  watchlistId: string | undefined;
  view: WatchlistViewStore;
  children: ReactNode;
}) {
  const { transport } = useWidget();
  const client = useQueryClient();
  const save = useMutation(watchlistMutation(transport, client, watchlistId));
  const switchTo = useCallback(
    (id: string) => view.setState({ selectedWatchlistId: id }),
    [view],
  );
  const create = useMutation({
    ...createWatchlist(transport),
    onSuccess: (created) => {
      client.setQueryData(
        watchlistDetail(transport, created.id).queryKey,
        created,
      );
      void client.invalidateQueries({
        queryKey: watchlistList(transport).queryKey,
      });
      switchTo(created.id);
    },
  });
  // A new Watchlist starts with the columns of the one it replaces here.
  const createNext = (name: string) =>
    create.mutateAsync({
      name,
      metrics: client
        .getQueryData(watchlistDetail(transport, watchlistId).queryKey)
        ?.columns.map((column) => column.metric.kind),
    });
  const remove = useMutation(deleteWatchlist(transport, client));
  const Picker = useContext(WatchlistSymbolPicker);
  const [picking, setPicking] = useState<{ sectionId?: string }>();
  const [action, setAction] = useState<WatchlistAction>();
  const [quotes] = useState(() => new BehaviorSubject<Quotes>({}));
  const value = useMemo(
    () => ({
      watchlistId,
      view,
      save,
      quotes,
      addSymbol: (sectionId?: string) => setPicking({ sectionId }),
      openDialog: setAction,
      switchTo,
    }),
    [watchlistId, view, save, quotes, switchTo],
  );
  return (
    <WatchlistPlacementContext.Provider value={value}>
      {children}
      {picking && Picker ? (
        <Picker
          onClose={() => setPicking(undefined)}
          onSelect={async (listing) => {
            await save.mutateAsync((watchlist) =>
              addListing(watchlist, listing, picking.sectionId),
            );
            setPicking(undefined);
          }}
        />
      ) : null}
      {action ? (
        <WatchlistDialog
          target={action}
          pending={save.isPending || create.isPending || remove.isPending}
          onClose={() => setAction(undefined)}
          onSubmit={(name) => {
            if (action.kind === "new-watchlist") return createNext(name);
            if (action.kind === "delete-watchlist" && watchlistId)
              return remove.mutateAsync(watchlistId);
            return save.mutateAsync((watchlist) => {
              switch (action.kind) {
                case "delete-section":
                  return removeNode(watchlist, action.sectionId);
                case "delete-watchlist":
                  return [];
                case "new-section":
                  return addSection(watchlist, name, action.parentId);
                case "section":
                  return renameSection(watchlist, action.sectionId, name);
                case "watchlist":
                  return [{ op: "replace", path: "/name", value: name }];
              }
            });
          }}
        />
      ) : null}
    </WatchlistPlacementContext.Provider>
  );
}

/** A collapsible tree of listings sharing one set of metric columns. The card
 * chrome stays generic; switching, naming, and adding live in the content. */
export const watchlistWidget: WidgetDefinition = {
  kind: "watchlist",
  title: "Watchlist",
  Icon: ListTree,
  defaultSize: { w: 4, h: 12 },
  minSize: { w: 3, h: 6 },
  Provider: WatchlistPlacement,
  Content: WatchlistView,
};
