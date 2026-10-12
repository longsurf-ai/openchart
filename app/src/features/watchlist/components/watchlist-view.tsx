// Purpose: Show one Watchlist's name, shared column header, and tree, with in-card loading and failure states.
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "zustand";

import { Button } from "@openchart/app/components/ui/button";
import { useWidget } from "@openchart/app/hooks/use-widget";
import { cn } from "@openchart/app/utils/cn";

import { watchlistDetail, type Watchlist } from "../api/queries";
import {
  migrateWatchlistSort,
  type WatchlistView as View,
} from "../stores/view";
import {
  columnLabel,
  columnTitle,
  columnWidth,
  gridTemplate,
  minimumGridWidth,
} from "../utils/columns";
import { hasVisibleRows, moveColumn, type Column } from "../utils/tree";
import { useWatchlistPlacement } from "./context";
import { FormulaRuntime } from "../hooks/formula-runtime";
import { WatchlistHeader } from "./header";
import { WatchlistTree } from "./watchlist-tree";

const COLUMN_TYPE = "application/x-openchart-watchlist-column";

/** The widget's content: in-card states, then the header and tree. */
export function WatchlistView() {
  const { transport } = useWidget();
  const { watchlistId } = useWatchlistPlacement();
  const query = useQuery(watchlistDetail(transport, watchlistId));
  if (!watchlistId)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <WatchlistHeader watchlist={null} />
        <p className="p-4 text-sm text-muted-foreground">
          Choose a watchlist or create a new one.
        </p>
      </div>
    );
  if (query.isPending)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading watchlist…
      </p>
    );
  if (query.isError)
    return (
      <div role="alert" className="space-y-2 p-4 text-sm">
        <p>Couldn’t load this watchlist.</p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (!query.data)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <WatchlistHeader watchlist={null} />
        <p className="p-4 text-sm text-muted-foreground">
          This watchlist was deleted. Choose another or create a new one.
        </p>
      </div>
    );
  return <Loaded watchlist={query.data} />;
}

function Loaded({ watchlist }: { watchlist: Watchlist }) {
  const { addSymbol, view, formulaValues } = useWatchlistPlacement();
  useEffect(() => migrateWatchlistSort(view, watchlist), [view, watchlist]);
  const columns = watchlist.columns.filter(
    (column) => column.visible !== false,
  );
  const empty = !hasVisibleRows(watchlist.sections);
  const tableStyle = {
    gridTemplateColumns: gridTemplate(columns),
    minWidth: minimumGridWidth(columns),
    "--watchlist-metric-space": columns.length
      ? `max(${columns.map(columnWidth).join(", ")})`
      : "0px",
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <FormulaRuntime watchlist={watchlist} values={formulaValues} />
      <WatchlistHeader watchlist={watchlist} />
      <div className="min-h-0 flex-1 overflow-auto [container-type:inline-size]">
        <div className="grid min-w-full" style={tableStyle}>
          <ColumnHeader columns={columns} />
          {empty ? (
            <div className="col-span-full flex flex-col items-center gap-2 p-6 text-sm text-muted-foreground">
              <p>No symbols yet.</p>
              <Button variant="outline" size="sm" onClick={() => addSymbol()}>
                <Plus aria-hidden />
                Add symbol
              </Button>
            </div>
          ) : (
            <WatchlistTree watchlist={watchlist} columns={columns} />
          )}
        </div>
      </div>
    </div>
  );
}

// Click cycles ascending, descending, then saved order, as in V1.
function nextSort(sort: View["sort"], columnId: string): View["sort"] {
  if (sort?.columnId !== columnId) return { columnId, direction: "asc" };
  return sort.direction === "asc" ? { columnId, direction: "desc" } : null;
}

function ColumnHeader({ columns }: { columns: readonly Column[] }) {
  const { save, view } = useWatchlistPlacement();
  const sort = useStore(view, (state) => state.sort);
  const [over, setOver] = useState<number>();
  return (
    <div
      role="row"
      className="sticky top-0 z-20 col-span-full grid h-7 grid-cols-subgrid items-center border-b bg-background text-xs text-muted-foreground"
    >
      <span role="columnheader" className="sticky left-0 z-10 bg-inherit pl-2">
        Symbol
      </span>
      {columns.map((column, index) => {
        const columnId = column.id;
        const sorted = sort?.columnId === columnId ? sort.direction : undefined;
        return (
          <button
            key={columnId}
            type="button"
            role="columnheader"
            aria-sort={
              sorted === "asc"
                ? "ascending"
                : sorted === "desc"
                  ? "descending"
                  : "none"
            }
            title={`${columnTitle(column)} · drag to reorder`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(COLUMN_TYPE, columnId);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(COLUMN_TYPE)) return;
              event.preventDefault();
              setOver(index);
            }}
            onDragLeave={() => setOver(undefined)}
            onDrop={(event) => {
              setOver(undefined);
              const fromId = event.dataTransfer.getData(COLUMN_TYPE);
              if (!fromId) return;
              event.preventDefault();
              save.mutate((current) => moveColumn(current, fromId, columnId));
            }}
            onClick={() =>
              view.setState({ sort: nextSort(view.getState().sort, columnId) })
            }
            className={cn(
              "flex h-full items-center justify-end gap-0.5 pr-3 outline-none hover:text-foreground focus-visible:text-foreground",
              sorted && "text-foreground",
              over === index && "bg-accent",
            )}
          >
            {sorted === "asc" ? (
              <ArrowUp aria-hidden className="size-3" />
            ) : sorted === "desc" ? (
              <ArrowDown aria-hidden className="size-3" />
            ) : null}
            <span className="truncate">{columnLabel(column)}</span>
          </button>
        );
      })}
    </div>
  );
}
