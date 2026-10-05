// Purpose: Select actual provider-scoped listings from the existing merged symbol search.
import { offersRetry } from "@openchart/app/lib/feed/transport";
import type { BarsCapabilities } from "@openchart/feed";
import type { ProviderListing } from "@openchart/market";
import { useMutation } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import { Input } from "@openchart/app/components/ui/input";
import { useDatafeed } from "@openchart/app/hooks/use-datafeed";
import { useSymbology } from "@openchart/app/hooks/use-symbology";

/** The caller captures the chart target before opening this dialog. @example <SymbolPicker onSelect={selectListing} onClose={close} /> */
export function SymbolPicker({
  onSelect,
  onClose,
  initialQuery = "",
}: {
  onSelect: (
    listing: ProviderListing,
    capabilities: BarsCapabilities,
  ) => void | Promise<void>;
  onClose: () => void;
  initialQuery?: string;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Find a symbol</DialogTitle>
          <DialogDescription>
            Search by symbol or company name. Each result includes its data
            provider.
          </DialogDescription>
        </DialogHeader>
        <SymbolSearch onSelect={onSelect} initialQuery={initialQuery} />
      </DialogContent>
    </Dialog>
  );
}

/** Reusable symbol selection inside a Dialog or widget gallery; failed selections keep the search open.
 * @example <SymbolSearch initialQuery="AAPL" onSelect={addChart} />
 */
export function SymbolSearch({
  onSelect,
  initialQuery = "",
}: {
  onSelect: (
    listing: ProviderListing,
    capabilities: BarsCapabilities,
  ) => void | Promise<void>;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const client = useDatafeed();
  const selection = useMutation({
    mutationFn: async (listing: ProviderListing) => {
      const capabilities = await client.bars.getCapabilities(listing);
      if (!capabilities.length)
        throw new Error("This source does not currently provide chart data.");
      await onSelect(listing, capabilities);
    },
  });
  const deferred = useDeferredValue(query.trim());
  const results = useSymbology(
    { query: deferred || " ", limit: 30, indexed: false },
    { enabled: !!deferred },
  );
  const indexed = useSymbology(
    { query: deferred || " ", limit: 30, indexed: true },
    { enabled: !!deferred && results.isPending },
  );
  // Saved hits accelerate display; only provider results complete the search.
  const listings =
    results.data ?? (results.isPending ? indexed.data : undefined);
  return (
    <>
      <Input
        aria-label="Search symbols"
        placeholder="AAPL, Bitcoin, Microsoft…"
        value={query}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- The search field is the dialog's only purpose.
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="-mx-2 flex max-h-96 flex-col gap-0.5 overflow-y-auto px-2 text-sm">
        {selection.isPending ? (
          <p role="status" className="px-2 py-1 text-muted-foreground">
            Opening symbol…
          </p>
        ) : null}
        {deferred && results.isPending ? (
          <p role="status" className="px-2 py-1 text-muted-foreground">
            Searching…
          </p>
        ) : null}
        {results.error && offersRetry(results.error) ? (
          <p className="px-2 py-1 text-destructive">
            <Button
              variant="link"
              className="h-auto p-0 font-normal text-foreground underline"
              onClick={() => {
                void results.refetch();
              }}
            >
              Retry
            </Button>
          </p>
        ) : null}
        {listings?.map((hit) => (
          <button
            type="button"
            key={`${hit.provider}:${hit.listing.symbol}:${hit.listing.venue}`}
            disabled={selection.isPending}
            className="grid w-full grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
            onClick={() => selection.mutate(hit)}
          >
            <span className="truncate font-semibold">{hit.listing.symbol}</span>
            <span className="truncate text-muted-foreground">
              {hit.listing.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {hit.provider} · {hit.listing.currency}
            </span>
          </button>
        ))}
        {deferred && results.data?.length === 0 ? (
          <p className="px-2 py-1 text-muted-foreground">
            No matching symbols.
          </p>
        ) : null}
      </div>
    </>
  );
}
