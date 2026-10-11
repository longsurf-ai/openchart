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
import { useEffect, useMemo, type CSSProperties } from "react";
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
import { listingLogoIdentifier, useLogo } from "@openchart/app/hooks/use-logo";
import { cn } from "@openchart/app/utils/cn";

import type { Watchlist } from "../api/queries";
import {
  useDailyRequest,
  useLiveQuote,
  useSortQuotes,
  type Quote,
} from "../hooks/use-quote";
import type { WatchlistView } from "../stores/view";
import { formatMetric, gridTemplate, metricTone } from "../utils/columns";
import {
  indexWatchlist,
  moveOperation,
  removeNode,
  ROOT_ID,
  type Metric,
  type WatchlistNode,
} from "../utils/tree";
import { useWatchlistPlacement } from "./context";

type Item = Extract<WatchlistNode, { kind: "item" }>["item"];
type Sort = NonNullable<WatchlistView["sort"]>;

const INDENT = 16;

// Rows sort by value inside each section; missing values stay last.
function sortRows(
  ids: readonly string[],
  nodes: Map<string, WatchlistNode>,
  quotes: Readonly<Record<string, Quote>>,
  sort: Sort,
): string[] {
  const value = (id: string) => {
    const node = nodes.get(id);
    return node?.kind === "item"
      ? quotes[providerListingKey(node.item)]?.[sort.metric]
      : undefined;
  };
  return [...ids].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (a === undefined || b === undefined)
      return a === b ? 0 : a === undefined ? 1 : -1;
    return sort.direction === "asc" ? a - b : b - a;
  });
}

/** Collapsible sections and draggable rows; each drop saves one JSON Patch move. @example <WatchlistTree watchlist={watchlist} metrics={["price"]} /> */
export function WatchlistTree({
  watchlist,
  metrics,
}: {
  watchlist: Watchlist;
  metrics: readonly Metric[];
}) {
  const { save, view, openDialog } = useWatchlistPlacement();
  const collapsed = useStore(view, (state) => state.collapsed);
  const sort = useStore(view, (state) => state.sort);
  // Only a sorted view re-renders when quotes change.
  const quotes = useSortQuotes(sort !== null);
  const nodes = useMemo(() => indexWatchlist(watchlist), [watchlist]);
  const children = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const node of nodes.values()) {
      if (node.kind !== "section" || !sort) result.set(node.id, node.children);
      else {
        const rows = node.section.items.length;
        result.set(node.id, [
          ...sortRows(node.children.slice(0, rows), nodes, quotes, sort),
          ...node.children.slice(rows),
        ]);
      }
    }
    return result;
  }, [nodes, sort, quotes]);
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
    indent: INDENT,
    features: [syncDataLoaderFeature, hotkeysCoreFeature, dragAndDropFeature],
  });
  // The sync loader reads `nodes` and `children`; rebuild when either changes.
  useEffect(() => {
    tree.rebuildTree();
  }, [tree, children, expandedItems]);
  const columns = { gridTemplateColumns: gridTemplate(metrics) };
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
    <div {...tree.getContainerProps("Watchlist")} className="outline-none">
      {tree.getItems().map((item) => {
        const node = item.getItemData();
        if (node.kind === "section")
          return node.section.name === undefined ? (
            <div key={item.getKey()} ref={item.getProps().ref} aria-hidden />
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
              metrics={metrics}
              style={columns}
              onRemove={() =>
                save.mutate((current) => removeNode(current, node.id))
              }
            />
          );
        return null;
      })}
      <div
        aria-hidden
        className="h-0.5 bg-primary"
        style={tree.getDragLineStyle(-1, lineOffset)}
      />
    </div>
  );
}

function rowState(item: ItemInstance<WatchlistNode>) {
  return cn(
    "relative outline-none hover:bg-accent/50 focus-visible:bg-accent",
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
              "flex h-8 cursor-default select-none items-center gap-1 border-b pr-2 text-xs font-medium uppercase tracking-wide text-muted-foreground",
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
  metrics,
  style,
  onRemove,
}: {
  item: ItemInstance<WatchlistNode>;
  node: Extract<WatchlistNode, { kind: "item" }>;
  metrics: readonly Metric[];
  style: CSSProperties;
  onRemove: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            {...item.getProps()}
            className={cn(
              "grid h-8 cursor-default select-none items-center border-b text-sm",
              rowState(item),
            )}
            style={style}
          >
            <SymbolCell item={node.item} depth={node.depth} />
            <QuoteCells item={node.item} metrics={metrics} />
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
  const logo = useLogo(listingLogoIdentifier(item.listing), {
    silent: true,
  }).data;
  return (
    <div
      className="flex min-w-0 items-center gap-2 pr-2"
      style={{ paddingLeft: depth * INDENT + 8 }}
      title={item.listing.name ?? item.listing.symbol}
    >
      <Avatar key={logo?.url ?? "letter"} className="size-5 shrink-0">
        {logo?.url ? (
          <AvatarImage src={logo.url} className="bg-white p-0.5" />
        ) : null}
        <AvatarFallback className="text-2xs">
          {item.listing.symbol.slice(0, 1)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate font-medium">{item.listing.symbol}</span>
    </div>
  );
}

function QuoteCells({
  item,
  metrics,
}: {
  item: Item;
  metrics: readonly Metric[];
}) {
  // Feed requests are strict: send the listing identity, never the row's own id.
  const { request, error, retry } = useDailyRequest({
    provider: item.provider,
    listing: item.listing,
  });
  if (error)
    return (
      <QuoteFailure
        symbol={item.listing.symbol}
        metrics={metrics}
        retry={retry}
      />
    );
  if (!request) return <MetricCells metrics={metrics} />;
  return (
    <LiveQuoteCells
      key={providerListingKey(item)}
      request={request}
      quoteKey={providerListingKey(item)}
      metrics={metrics}
    />
  );
}

function LiveQuoteCells({
  request,
  quoteKey,
  metrics,
}: {
  request: BarsRequest;
  quoteKey: string;
  metrics: readonly Metric[];
}) {
  const { quote, error, retry } = useLiveQuote(request, quoteKey);
  if (error)
    return (
      <QuoteFailure
        symbol={request.listing.symbol}
        metrics={metrics}
        retry={retry}
      />
    );
  return <MetricCells metrics={metrics} quote={quote} />;
}

function QuoteFailure({
  symbol,
  metrics,
  retry,
}: {
  symbol: string;
  metrics: readonly Metric[];
  retry: () => void;
}) {
  if (!metrics.length) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-self-end text-xs text-muted-foreground"
      style={{ gridColumn: `span ${metrics.length}` }}
      aria-label={`Retry quote for ${symbol}`}
      onClick={() => retry()}
    >
      <RefreshCw className="size-3" aria-hidden /> Retry quote
    </Button>
  );
}

function MetricCells({
  metrics,
  quote,
}: {
  metrics: readonly Metric[];
  quote?: Quote;
}) {
  return metrics.map((metric) => (
    <span
      key={metric}
      className={cn(
        "truncate pr-3 text-right tabular-nums",
        metricTone(metric, quote),
      )}
    >
      {formatMetric(metric, quote)}
    </span>
  ));
}
