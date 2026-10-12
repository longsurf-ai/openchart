// Purpose: Give custom widgets the Dashboard's canonical symbol, set from the page header's symbol control.
import type { ProviderListing } from "@openchart/market";
import { useEffect, useState } from "react";
import { createStore, useStore } from "zustand";
import { persist } from "zustand/middleware";

import { SymbolButton } from "@openchart/app/features/chart/components/symbol-control";
import { SymbolPicker } from "@openchart/app/features/chart/components/symbol-picker";
import { useWidget } from "@openchart/app/hooks/use-widget";

type Symbols = {
  /** Each placement's chosen listing, remembered on this device. */
  readonly listings: Readonly<Record<string, ProviderListing>>;
  /** Mounted placements whose widget reads its symbol, by mount count. */
  readonly readers: Readonly<Record<string, number>>;
};

// ponytail: listings of removed placements stay in local storage; prune when that grows.
const symbols = createStore<Symbols>()(
  persist(() => ({ listings: {}, readers: {} }), {
    name: "local:custom-widget-symbols",
    version: 1,
    partialize: ({ listings }) => ({ listings }),
  }),
);

function countReader(placementId: string, delta: 1 | -1) {
  symbols.setState(({ readers }) => {
    const count = (readers[placementId] ?? 0) + delta;
    const next = { ...readers, [placementId]: count };
    if (count <= 0) delete next[placementId];
    return { readers: next };
  });
}

/**
 * The listing this widget shows, chosen with the Dashboard's own symbol control
 * at the top left of the page, never a picker inside the widget. Clicking or
 * focusing a widget that calls this makes it the control's target, as clicking
 * a chart does. Undefined until the user chooses one; remembered per placement.
 * @example const listing = useSymbol(); if (!listing) return <p>Click here, then choose a symbol at the top left.</p>;
 */
export function useSymbol(): ProviderListing | undefined {
  const { placementId } = useWidget();
  useEffect(() => {
    countReader(placementId, 1);
    return () => countReader(placementId, -1);
  }, [placementId]);
  return useStore(symbols, (state) => state.listings[placementId]);
}

/** Whether this placement's mounted widget reads its symbol, read at event time. @example if (readsSymbol(placementId)) focusWidget(placementId); */
export function readsSymbol(placementId: string) {
  return !!symbols.getState().readers[placementId];
}

/** Placements whose mounted widget reads its symbol; the header targets only these. @example const readers = useSymbolReaders(); */
export function useSymbolReaders() {
  return useStore(symbols, (state) => state.readers);
}

/** The header's symbol control aimed at one custom widget: the same button and picker charts use. Key it by placement so a new target closes an open picker. @example <WidgetSymbolControl key={placementId} placementId={placementId} /> */
export function WidgetSymbolControl({ placementId }: { placementId: string }) {
  const listing = useStore(symbols, (state) => state.listings[placementId]);
  const [picking, setPicking] = useState(false);
  return (
    <>
      <SymbolButton
        listing={listing}
        label="Choose a widget symbol"
        onClick={() => setPicking(true)}
      />
      {picking ? (
        <SymbolPicker
          onClose={() => setPicking(false)}
          onSelect={(next) => {
            symbols.setState(({ listings }) => ({
              listings: { ...listings, [placementId]: next },
            }));
            setPicking(false);
          }}
        />
      ) : null}
    </>
  );
}
