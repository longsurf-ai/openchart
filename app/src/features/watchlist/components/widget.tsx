// Purpose: Adapt a Dashboard placement to one Watchlist and own its dialogs, switching, and lifecycle actions.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  replaceEqualDeep,
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
  formulaColumnMutation,
  type FormulaSource,
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
  removeColumn,
  type Column,
} from "../utils/tree";
import {
  WatchlistPlacementContext,
  WatchlistSymbolPicker,
  WatchlistFormulaPicker,
  type FormulaValues,
  type SemanticValues,
  type WatchlistAction,
} from "./context";
import { WatchlistDialog } from "./watchlist-dialog";
import { FormulaColumnDialog } from "./formula-column-dialog";
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
    const next =
      lists.data?.[
        lists.data.findIndex(
          (item) =>
            client.getQueryData(
              watchlistDetail(transport, item.id).queryKey,
            ) !== null,
        )
      ]?.id;
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
      columns: client.getQueryData(
        watchlistDetail(transport, watchlistId).queryKey,
      )?.columns,
    });
  const remove = useMutation(deleteWatchlist(transport, client));
  const Picker = useContext(WatchlistSymbolPicker);
  const [picking, setPicking] = useState<{ sectionId?: string }>();
  const [action, setAction] = useState<WatchlistAction>();
  const [quotes] = useState(() => new BehaviorSubject<Quotes>({}));
  const [crosshair] = useState(() => new BehaviorSubject<number | null>(null));
  const [formulaValues] = useState(
    () => new BehaviorSubject<FormulaValues>({}),
  );
  const [semanticValues] = useState(
    () => new BehaviorSubject<SemanticValues>({}),
  );
  const FormulaPicker = useContext(WatchlistFormulaPicker);
  const [pickingFormula, setPickingFormula] = useState(false);
  const [formula, setFormula] = useState<{
    source: FormulaSource;
    column?: Column;
    revision: number;
    open: boolean;
    draftVersion?: number;
  }>();
  const currentWatchlist = useQuery(
    watchlistDetail(transport, watchlistId),
  ).data;
  const latestColumn =
    currentWatchlist?.columns[
      currentWatchlist.columns.findIndex(
        (column) => column.id === formula?.column?.id,
      )
    ];
  const columnChanged =
    formula?.column !== undefined &&
    currentWatchlist !== undefined &&
    replaceEqualDeep(formula.column, latestColumn) !== formula.column;
  const editFormula = useMutation(
    formulaColumnMutation(transport, client, watchlistId),
  );
  const configureFormula = useCallback(
    (columnId: string) => {
      const current = client.getQueryData(
        watchlistDetail(transport, watchlistId).queryKey,
      );
      const column =
        current?.columns[
          current.columns.findIndex((item) => item.id === columnId)
        ];
      if (column?.metric.kind !== "formula" || !current) return;
      const source = column.metric.source;
      setFormula((draft) =>
        draft?.column?.id === columnId
          ? { ...draft, open: true }
          : {
              source,
              column,
              revision: current.revision,
              open: true,
            },
      );
    },
    [client, transport, watchlistId],
  );
  const value = useMemo(
    () => ({
      watchlistId,
      view,
      save,
      quotes,
      crosshair,
      formulaValues,
      semanticValues,
      addFormula: () => {
        if (formula && !formula.column) setFormula({ ...formula, open: true });
        else setPickingFormula(true);
      },
      configureFormula,
      addSymbol: (sectionId?: string) => setPicking({ sectionId }),
      openDialog: setAction,
      switchTo,
    }),
    [
      watchlistId,
      view,
      save,
      quotes,
      crosshair,
      formulaValues,
      semanticValues,
      configureFormula,
      formula,
      switchTo,
    ],
  );
  return (
    <WatchlistPlacementContext.Provider value={value}>
      {children}
      {pickingFormula && FormulaPicker ? (
        <FormulaPicker
          onClose={() => setPickingFormula(false)}
          onSelect={(source) => {
            const current = client.getQueryData(
              watchlistDetail(transport, watchlistId).queryKey,
            );
            if (!current) return;
            setPickingFormula(false);
            setFormula({ source, revision: current.revision, open: true });
          }}
        />
      ) : null}
      {formula ? (
        <FormulaColumnDialog
          key={`${formula.column?.id ?? `${formula.source.workspaceId}:${formula.source.path}`}:${formula.draftVersion ?? 0}`}
          target={formula}
          conflict={
            columnChanged ? (latestColumn ? "changed" : "removed") : undefined
          }
          onLoadSaved={() => {
            if (latestColumn?.metric.kind !== "formula" || !currentWatchlist)
              return;
            setFormula({
              source: latestColumn.metric.source,
              column: latestColumn,
              revision: currentWatchlist.revision,
              open: true,
              draftVersion: (formula.draftVersion ?? 0) + 1,
            });
          }}
          open={formula.open}
          pending={editFormula.isPending || save.isPending}
          onClose={() => setFormula(undefined)}
          onSuspend={() => setFormula({ ...formula, open: false })}
          onSave={(settings, expectedRevision) =>
            editFormula.mutateAsync(
              formula.column
                ? {
                    kind: "configure",
                    columnId: formula.column.id,
                    expectedColumn: formula.column,
                    settings,
                    expectedRevision,
                  }
                : {
                    kind: "add",
                    source: formula.source,
                    settings,
                    expectedRevision,
                  },
            )
          }
          onReload={async (expectedRevision) => {
            if (!formula.column)
              throw new Error("Save the column before reloading.");
            const updated = await editFormula.mutateAsync({
              kind: "reload",
              columnId: formula.column.id,
              expectedColumn: formula.column,
              expectedRevision,
            });
            const column =
              updated.columns[
                updated.columns.findIndex(
                  (column) => column.id === formula.column?.id,
                )
              ];
            if (column)
              setFormula({ ...formula, column, revision: updated.revision });
            return updated;
          }}
          onRemove={() =>
            save.mutateAsync((current) =>
              formula.column ? removeColumn(current, formula.column.id) : [],
            )
          }
        />
      ) : null}
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
