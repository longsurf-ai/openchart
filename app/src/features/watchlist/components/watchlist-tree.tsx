// Purpose: Render a Watchlist's sections and rows as one collapsible, draggable tree sharing column tracks.
import {
  dragAndDropFeature,
  hotkeysCoreFeature,
  syncDataLoaderFeature,
  type DragTarget,
  type ItemInstance,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { BarsRequest } from "@openchart/feed";
import { providerListingKey } from "@openchart/market";
import {
  ChevronRight,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@openchart/app/components/ui/avatar/avatar";
import { Button } from "@openchart/app/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@openchart/app/components/ui/context-menu";
import { useIntent } from "@openchart/app/hooks/use-intent";
import { logoUrl } from "@openchart/app/lib/logo/logo";
import { viewChart } from "@openchart/app/lib/widget/intent/intents";
import { cn } from "@openchart/app/utils/cn";

import type { Watchlist } from "../api/queries";
import {
  quoteAt,
  useDailyRequest,
  useLiveQuote,
  useSortQuotes,
  type Quote,
} from "../hooks/use-quote";
import type { WatchlistView } from "../stores/view";
import { formatFormula, formatMetric, metricTone } from "../utils/columns";
import {
  indexWatchlist,
  moveOperation,
  removeNode,
  ROOT_ID,
  type Column,
  type WatchlistNode,
} from "../utils/tree";
import { useWatchlistPlacement, type FormulaValues } from "./context";
import { Sparkline } from "./sparkline";
import { LiveNumber } from "./live-number";

import {
  useFormulaCells,
  useSortFormulaValues,
} from "../hooks/use-formula-cells";

type Item = Extract<WatchlistNode, { kind: "item" }>["item"];
type Sort = NonNullable<WatchlistView["sort"]>;

const INDENT = 16;

// Rows sort by value inside each section; missing values stay last.
function sortRows(
  ids: readonly string[],
  nodes: Map<string, WatchlistNode>,
  quotes: Readonly<Record<string, Quote>>,
  sort: Sort,
  column: Column | undefined,
  formulas: FormulaValues,
): string[] {
  const value = (id: string) => {
    const node = nodes.get(id);
    if (node?.kind !== "item" || !column) return undefined;
    if (column.metric.kind === "formula") {
      const cell = formulas[node.id]?.[column.id];
      return cell?.status === "ready" && Number.isFinite(cell.value)
        ? cell.value
        : undefined;
    }
    // Price History sorts by the move it draws, not its hovered close.
    const metric =
      column.metric.kind === "priceHistory"
        ? "changePercent"
        : column.metric.kind;
    return quotes[providerListingKey(node.item)]?.[metric];
  };
  return [...ids].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (a === undefined || b === undefined)
      return a === b ? 0 : a === undefined ? 1 : -1;
    return sort.direction === "asc" ? a - b : b - a;
  });
}

/** Collapsible sections and draggable rows; each drop saves one JSON Patch move. Clicking a row, or Enter on it, raises ViewChart for its listing. @example <WatchlistTree watchlist={watchlist} columns={watchlist.columns} /> */
export function WatchlistTree({
  watchlist,
  columns,
}: {
  watchlist: Watchlist;
  columns: readonly Column[];
}) {
  const { save, view, openDialog } = useWatchlistPlacement();
  const chart = useIntent(viewChart);
  const collapsed = useStore(view, (state) => state.collapsed);
  const sort = useStore(view, (state) => state.sort);
  const sortColumn = columns.find((column) => column.id === sort?.columnId);
  // Only the active sort's stream can rebuild the tree.
  const quotes = useSortQuotes(
    !!sortColumn && sortColumn.metric.kind !== "formula",
  );
  const formulas = useSortFormulaValues(sortColumn?.metric.kind === "formula");
  const nodes = useMemo(() => indexWatchlist(watchlist), [watchlist]);
  const children = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const node of nodes.values()) {
      if (node.kind !== "section" || !sort) result.set(node.id, node.children);
      else {
        const rows = node.section.items.length;
        result.set(node.id, [
          ...sortRows(
            node.children.slice(0, rows),
            nodes,
            quotes,
            sort,
            sortColumn,
            formulas,
          ),
          ...node.children.slice(rows),
        ]);
      }
    }
    return result;
  }, [nodes, sort, quotes, sortColumn, formulas]);
  // Unnamed sections have no heading to collapse, so they always stay open.
  const expandedItems = useMemo(
    () =>
      [...nodes.values()]
        .filter(
          (node) =>
            node.kind === "section" &&
            (node.section.name === undefined || !collapsed.includes(node.id)),
        )
        .map((node) => node.id),
    [nodes, collapsed],
  );
  const drop = (
    items: ItemInstance<WatchlistNode>[],
    target: DragTarget<WatchlistNode>,
  ) => {
    const [item] = items;
    if (!item || items.length !== 1) return null;
    const node = item.getItemData();
    // Sorted rows have no saved position to drop between.
    if (sort && node.kind === "item" && "childIndex" in target) return null;
    return {
      id: node.id,
      parentId: target.item.getId(),
      index: "insertionIndex" in target ? target.insertionIndex : undefined,
    };
  };
  const tree = useTree<WatchlistNode>({
    rootItemId: ROOT_ID,
    state: { expandedItems },
    setExpandedItems: (update) => {
      const next =
        typeof update === "function" ? update(expandedItems) : update;
      view.setState({
        collapsed: [...nodes.values()]
          .filter(
            (node) =>
              node.kind === "section" &&
              node.section.name !== undefined &&
              !next.includes(node.id),
          )
          .map((node) => node.id),
      });
    },
    getItemName: (item) => {
      const node = item.getItemData();
      if (node.kind === "item") return node.item.listing.symbol;
      return node.kind === "section" ? (node.section.name ?? "") : "";
    },
    isItemFolder: (item) => item.getItemData().kind !== "item",
    dataLoader: {
      getItem: (id) => nodes.get(id)!,
      getChildren: (id) => children.get(id) ?? nodes.get(id)?.children ?? [],
    },
    canReorder: true,
    reorderAreaPercentage: 0.25,
    canDrop: (items, target) => {
      const move = drop(items, target);
      return (
        !!move && !!moveOperation(watchlist, move.id, move.parentId, move.index)
      );
    },
    onDrop: (items, target) => {
      const move = drop(items, target);
      if (!move) return;
      save.mutate((current) => {
        const operation = moveOperation(
          current,
          move.id,
          move.parentId,
          move.index,
        );
        // A drop in place is valid for targeting but saves nothing.
        return operation && operation.from !== operation.path
          ? [operation]
          : [];
      });
    },
    // Whichever widget answers decides where the listing appears.
    onPrimaryAction: (item) => {
      const node = item.getItemData();
      if (node.kind !== "item") return;
      const { provider, listing } = node.item;
      void chart.raise({ listing: { provider, listing } });
    },
    hotkeys: {
      customPrimaryAction: {
        hotkey: "Enter",
        handler: (event, tree) => {
          // Native button activation belongs to the cell action, not the row.
          if (event.target instanceof Element && event.target.closest("button"))
            return;
          tree.getFocusedItem().primaryAction();
        },
      },
    },
    indent: INDENT,
    features: [syncDataLoaderFeature, hotkeysCoreFeature, dragAndDropFeature],
  });
  // The sync loader reads `nodes` and `children`; rebuild when either changes.
  useEffect(() => {
    tree.rebuildTree();
  }, [tree, children, expandedItems]);
  const target = tree.getDragTarget();
  const parent = target?.item.getItemData();
  const depth =
    parent?.kind === "section"
      ? parent.depth + Number(parent.section.name !== undefined)
      : 0;
  // Hidden, unnamed sections do not contribute visible indentation.
  const lineOffset =
    target && "dragLineLevel" in target
      ? (depth - target.dragLineLevel) * INDENT
      : 0;
  return (
    <div
      {...tree.getContainerProps("Watchlist")}
      className="col-span-full grid grid-cols-subgrid outline-none"
    >
      {tree.getItems().map((item) => {
        const node = item.getItemData();
        if (node.kind === "section")
          return node.section.name === undefined ? (
            <div
              key={item.getKey()}
              ref={item.getProps().ref}
              aria-hidden
              className="col-span-full"
            />
          ) : (
            <SectionRow
              key={item.getKey()}
              item={item}
              node={node}
              onRemove={() =>
                openDialog({
                  kind: "delete-section",
                  sectionId: node.id,
                  name: node.section.name,
                })
              }
            />
          );
        if (node.kind === "item")
          return (
            <ItemRow
              key={item.getKey()}
              item={item}
              node={node}
              columns={columns}
              onRemove={() =>
                save.mutate((current) => removeNode(current, node.id))
              }
            />
          );
        return null;
      })}
      <div
        aria-hidden
        className="col-span-full h-0.5 bg-primary"
        style={tree.getDragLineStyle(-1, lineOffset)}
      />
    </div>
  );
}

function rowState(item: ItemInstance<WatchlistNode>) {
  return cn(
    "relative bg-background outline-none hover:bg-accent focus-visible:bg-accent",
    item.isUnorderedDragTarget() && "bg-accent ring-1 ring-inset ring-primary",
  );
}

function SectionRow({
  item,
  node,
  onRemove,
}: {
  item: ItemInstance<WatchlistNode>;
  node: Extract<WatchlistNode, { kind: "section" }>;
  onRemove: () => void;
}) {
  const { addSymbol, openDialog } = useWatchlistPlacement();
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            {...item.getProps()}
            className={cn(
              "col-span-full flex h-8 cursor-default select-none items-center gap-1 border-b pr-2 text-xs font-medium uppercase tracking-wide text-muted-foreground",
              rowState(item),
            )}
            style={{ paddingLeft: node.depth * INDENT + 4 }}
          >
            <ChevronRight
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
                item.isExpanded() && "rotate-90",
              )}
            />
            <span className="truncate">{node.section.name}</span>
          </div>
        }
      />
      <ContextMenuContent>
        <ContextMenuItem onClick={() => addSymbol(node.id)}>
          <Plus /> Add symbol here
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => openDialog({ kind: "new-section", parentId: node.id })}
        >
          <FolderPlus /> New section inside
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            openDialog({
              kind: "section",
              sectionId: node.id,
              name: node.section.name,
            })
          }
        >
          <Pencil /> Rename section
        </ContextMenuItem>
        <ContextMenuItem onClick={onRemove}>
          <Trash2 /> Delete section and its symbols
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ItemRow({
  item,
  node,
  columns,
  onRemove,
}: {
  item: ItemInstance<WatchlistNode>;
  node: Extract<WatchlistNode, { kind: "item" }>;
  columns: readonly Column[];
  onRemove: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            {...item.getProps()}
            className={cn(
              "col-span-full grid min-h-8 cursor-default select-none grid-cols-subgrid items-center border-b bg-background py-1 text-sm hover:bg-accent focus-visible:bg-accent",
              rowState(item),
            )}
          >
            <SymbolCell item={node.item} depth={node.depth} />
            <QuoteCells item={node.item} columns={columns} />
          </div>
        }
      />
      <ContextMenuContent>
        <ContextMenuItem onClick={onRemove}>
          <Trash2 /> Remove {node.item.listing.symbol}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SymbolCell({ item, depth }: { item: Item; depth: number }) {
  const logo = logoUrl(item.listing);
  // Leave room to read metric columns while the symbol remains pinned.
  const space = "max(6rem, calc(100cqi - var(--watchlist-metric-space, 0px)))";
  // Preserve indentation while reserving text space even inside a very narrow widget.
  const paddingLeft = `min(${depth * INDENT + 8}px, max(8px, calc(${space} - 8rem)))`;
  return (
    <div
      className="sticky left-0 z-10 flex min-w-max items-center gap-2 bg-inherit pr-2"
      style={{ paddingLeft }}
      title={item.listing.name ?? item.listing.symbol}
    >
      <Avatar key={logo} className="size-5 shrink-0">
        <AvatarImage src={logo} />
        <AvatarFallback className="text-2xs">
          {item.listing.symbol.slice(0, 1)}
        </AvatarFallback>
      </Avatar>
      <span
        className="min-w-0 break-all font-medium"
        style={{
          maxWidth: `max(1ch, calc(${space} - ${paddingLeft} - 2.25rem))`,
        }}
      >
        {item.listing.symbol}
      </span>
    </div>
  );
}

function QuoteCells({
  item,
  columns,
}: {
  item: Item;
  columns: readonly Column[];
}) {
  if (!columns.some((column) => column.metric.kind !== "formula"))
    return <MetricCells item={item} columns={columns} />;
  return <DailyQuoteCells item={item} columns={columns} />;
}

function DailyQuoteCells({
  item,
  columns,
}: {
  item: Item;
  columns: readonly Column[];
}) {
  // Feed requests are strict: send the listing identity, never the row's own id.
  const { request, error, retry } = useDailyRequest({
    provider: item.provider,
    listing: item.listing,
  });
  if (error)
    return (
      <MetricCells
        item={item}
        columns={columns}
        quoteError={{ symbol: item.listing.symbol, retry }}
      />
    );
  if (!request) return <MetricCells item={item} columns={columns} />;
  return (
    <LiveQuoteCells
      key={providerListingKey(item)}
      request={request}
      quoteKey={providerListingKey(item)}
      item={item}
      columns={columns}
    />
  );
}

function LiveQuoteCells({
  item,
  request,
  quoteKey,
  columns,
}: {
  item: Item;
  request: BarsRequest;
  quoteKey: string;
  columns: readonly Column[];
}) {
  const { quote, error, retry } = useLiveQuote(request, quoteKey);
  if (error)
    return (
      <MetricCells
        item={item}
        columns={columns}
        quoteError={{ symbol: request.listing.symbol, retry }}
      />
    );
  return <MetricCells item={item} columns={columns} quote={quote} />;
}

function MetricCells({
  item,
  columns,
  quote,
  quoteError,
}: {
  item: Item;
  columns: readonly Column[];
  quote?: Quote;
  quoteError?: { symbol: string; retry: () => void };
}) {
  const formulas = useFormulaCells(item.id);
  // Crosshair quotes change built-ins; Formula values remain on their latest bar.
  const [hovered, setHovered] = useState<number>();
  const shown = quoteAt(quote, hovered);
  const firstBuiltin = columns.find(
    (column) => column.metric.kind !== "formula",
  )?.id;
  return columns.map((column) => {
    if (column.metric.kind === "formula") {
      const cell = formulas?.[column.id];
      const text =
        cell?.status === "error"
          ? "Error"
          : cell?.status === "empty"
            ? "—"
            : cell?.status === "ready"
              ? formatFormula(cell.value)
              : "…";
      const time =
        cell?.time !== undefined && Number.isFinite(cell.time)
          ? new Date(cell.time).toLocaleString()
          : undefined;
      const title =
        cell?.status === "error"
          ? cell.error
          : cell?.status === "empty"
            ? `No value for the latest bar${time ? ` · ${time}` : ""}`
            : cell?.status === "ready" && time
              ? `Latest bar · ${time}`
              : undefined;
      return (
        <span
          key={column.id}
          className={cn(
            "truncate pr-3 text-right tabular-nums",
            cell?.status === "error" && "text-destructive",
          )}
          title={title}
        >
          {cell?.status === "error" && cell.retry ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={(event) => {
                event.stopPropagation();
                cell.retry?.();
              }}
              aria-label="Retry formula"
            >
              {text}
            </Button>
          ) : cell?.status === "ready" && cell.value !== undefined ? (
            <LiveNumber
              key={`${providerListingKey(item)}:${column.metric.output}:${cell.identity}`}
              value={cell.value}
              text={text}
            />
          ) : (
            text
          )}
        </span>
      );
    }
    if (quoteError && column.id !== firstBuiltin)
      return (
        <span key={column.id} className="pr-3 text-right text-muted-foreground">
          —
        </span>
      );
    if (quoteError)
      return (
        <Button
          key={column.id}
          variant="ghost"
          size="sm"
          className="justify-self-end text-xs text-muted-foreground"
          aria-label={`Retry quote for ${quoteError.symbol}`}
          onClick={(event) => {
            event.stopPropagation();
            quoteError.retry();
          }}
        >
          <RefreshCw className="size-3" aria-hidden /> Retry
        </Button>
      );
    if (column.metric.kind === "priceHistory")
      return (
        <Sparkline
          key={column.id}
          provider={item.provider}
          listing={item.listing}
          previousClose={quote?.previousClose}
          onHover={setHovered}
        />
      );
    return (
      <span
        key={column.id}
        className={cn(
          "truncate pr-3 text-right tabular-nums",
          metricTone(column.metric.kind, shown),
        )}
      >
        {column.metric.kind === "price" &&
        hovered === undefined &&
        shown?.price !== undefined ? (
          <LiveNumber value={shown.price} text={formatMetric("price", shown)} />
        ) : (
          formatMetric(column.metric.kind, shown)
        )}
      </span>
    );
  });
}
