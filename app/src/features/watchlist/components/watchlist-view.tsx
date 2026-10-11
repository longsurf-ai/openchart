// Purpose: Show one Watchlist's name, shared column header, and tree, with in-card loading and failure states.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useState } from "react";
import { useStore } from "zustand";

import { Button } from "@openchart/app/components/ui/button";
import { useWidget } from "@openchart/app/hooks/use-widget";
import { cn } from "@openchart/app/utils/cn";

import {
  watchlistDetail,
  watchlistMutation,
  type Watchlist,
} from "../api/queries";
import type { WatchlistView as View } from "../stores/view";
import { COLUMNS, gridTemplate } from "../utils/columns";
import { moveColumn, type Metric } from "../utils/tree";
import { useWatchlistPlacement } from "./context";
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
  const { addSymbol } = useWatchlistPlacement();
  const metrics = watchlist.columns.map((column) => column.metric.kind);
  const empty = watchlist.sections.length === 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WatchlistHeader watchlist={watchlist} />
      <ColumnHeader watchlist={watchlist} metrics={metrics} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex flex-col items-center gap-2 p-6 text-sm text-muted-foreground">
            <p>No symbols yet.</p>
            <Button variant="outline" size="sm" onClick={() => addSymbol()}>
              <Plus aria-hidden />
              Add symbol
            </Button>
          </div>
        ) : (
          <WatchlistTree watchlist={watchlist} metrics={metrics} />
        )}
      </div>
    </div>
  );
}

// Click cycles ascending, descending, then saved order, as in V1.
function nextSort(sort: View["sort"], metric: Metric): View["sort"] {
  if (sort?.metric !== metric) return { metric, direction: "asc" };
  return sort.direction === "asc" ? { metric, direction: "desc" } : null;
}

function ColumnHeader({
  watchlist,
  metrics,
}: {
  watchlist: Watchlist;
  metrics: readonly Metric[];
}) {
  const { transport } = useWidget();
  const { watchlistId, view } = useWatchlistPlacement();
  const client = useQueryClient();
  const save = useMutation(watchlistMutation(transport, client, watchlistId));
  const sort = useStore(view, (state) => state.sort);
  const [over, setOver] = useState<number>();
  return (
    <div
      role="row"
      className="grid h-7 shrink-0 items-center border-b text-xs text-muted-foreground"
      style={{ gridTemplateColumns: gridTemplate(metrics) }}
    >
      <span role="columnheader" className="pl-2">
        Symbol
      </span>
      {metrics.map((metric, index) => {
        const columnId = watchlist.columns[index]!.id;
        const sorted = sort?.metric === metric ? sort.direction : undefined;
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
            title={`${COLUMNS[metric].title} · drag to reorder`}
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
              view.setState({ sort: nextSort(view.getState().sort, metric) })
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
            {COLUMNS[metric].label}
          </button>
        );
      })}
    </div>
  );
}
