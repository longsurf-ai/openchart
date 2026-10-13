// Purpose: Page through Watchlists inside the widget's selection menu.
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";

import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@openchart/app/components/ui/dropdown";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { watchlistList } from "../api/queries";

/** Read cursor pages as the menu scrolls. Query owns requests and error reporting;
 * closing the menu disconnects its observer. Failed pages offer an explicit retry.
 * @example <WatchlistMenuItems transport={transport} selectedId={id} onPick={select} />
 */
export function WatchlistMenuItems({
  transport,
  selectedId,
  onPick,
}: {
  transport: AppTransport;
  selectedId: string | undefined;
  onPick: (watchlistId: string) => void;
}) {
  const list = useInfiniteQuery(watchlistList(transport));
  const { hasNextPage, isFetching, isError, fetchNextPage } = list;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = end.current;
    if (!target || !hasNextPage || isFetching || isError) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void fetchNextPage();
      },
      { root: target.closest('[role="menu"]'), rootMargin: "0px 0px 80px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetching, isError, fetchNextPage]);
  return (
    <>
      <DropdownMenuRadioGroup value={selectedId} onValueChange={onPick}>
        {list.data?.map<ReactNode>((watchlist) => (
          <DropdownMenuRadioItem key={watchlist.id} value={watchlist.id}>
            <span className="truncate">{watchlist.name}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {isError ? (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            if (list.isFetchNextPageError) void fetchNextPage();
            else void list.refetch();
          }}
        >
          Retry loading watchlists
        </DropdownMenuItem>
      ) : isFetching ? (
        <DropdownMenuItem disabled>Loading watchlists…</DropdownMenuItem>
      ) : !list.data?.length ? (
        <DropdownMenuItem disabled>No watchlists yet</DropdownMenuItem>
      ) : null}
      <div ref={end} className="h-px" aria-hidden />
    </>
  );
}
