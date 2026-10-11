// Purpose: Own the Watchlist's switcher, naming, and add/column actions inside its content, not the card chrome.
import {
  ChevronDown,
  Columns3,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { useWidget } from "@openchart/app/hooks/use-widget";

import type { Watchlist } from "../api/queries";
import { COLUMNS } from "../utils/columns";
import { METRICS, toggleColumn } from "../utils/tree";
import { useWatchlistPlacement } from "./context";
import { WatchlistMenuItems } from "./watchlist-menu";

function Action({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The Watchlist menu and actions; a deleted Watchlist keeps only switching and creation. @example <WatchlistHeader watchlist={watchlist} /> */
export function WatchlistHeader({
  watchlist,
}: {
  watchlist: Watchlist | null;
}) {
  const { transport } = useWidget();
  const { save, watchlistId, addSymbol, openDialog, switchTo } =
    useWatchlistPlacement();
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 px-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 gap-1 px-1.5 font-semibold"
          >
            <span
              className={
                watchlist ? "truncate" : "truncate text-muted-foreground"
              }
            >
              {watchlist?.name ?? "Watchlists"}
            </span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {watchlist ? (
            <DropdownMenuItem
              onSelect={() =>
                openDialog({ kind: "watchlist", name: watchlist.name })
              }
            >
              <Pencil /> Rename
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => openDialog({ kind: "new-watchlist" })}
          >
            <Plus /> New watchlist
          </DropdownMenuItem>
          {watchlist ? (
            <DropdownMenuItem
              onSelect={() =>
                openDialog({ kind: "delete-watchlist", name: watchlist.name })
              }
            >
              <Trash2 /> Delete watchlist
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Watchlists</DropdownMenuLabel>
          <WatchlistMenuItems
            transport={transport}
            selectedId={watchlistId}
            onPick={switchTo}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {watchlist ? (
        <div className="ml-auto flex shrink-0 items-center">
          <Action label="Add symbol" onClick={() => addSymbol()}>
            <Plus className="size-4" />
          </Action>
          <Action
            label="New section"
            onClick={() => openDialog({ kind: "new-section" })}
          >
            <FolderPlus className="size-4" />
          </Action>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Columns">
                    <Columns3 className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Columns</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              {METRICS.map((metric) => (
                <DropdownMenuCheckboxItem
                  key={metric}
                  checked={watchlist.columns.some(
                    (column) => column.metric.kind === metric,
                  )}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() =>
                    save.mutate((current) => toggleColumn(current, metric))
                  }
                >
                  {COLUMNS[metric].title}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}
