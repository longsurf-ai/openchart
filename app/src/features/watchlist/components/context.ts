// Purpose: Share one placement's Watchlist identity, view state, and dialogs between its controls and content.
import type { ProviderListing } from "@openchart/market";
import { createContext, useContext, type ComponentType } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { Quote } from "../hooks/use-quote";

import type { WatchlistViewStore } from "../stores/view";

/** The symbol search app composition supplies; features never import each other. */
export type SymbolPickerProps = {
  onSelect: (listing: ProviderListing) => void | Promise<void>;
  onClose: () => void;
};

/** App composition provides the symbol search dialog for adding rows. */
export const WatchlistSymbolPicker =
  createContext<ComponentType<SymbolPickerProps> | null>(null);

/** What a name dialog edits: a new or existing section, or a new or existing Watchlist. */
export type NameTarget =
  | { kind: "new-section"; parentId?: string }
  | { kind: "section"; sectionId: string; name?: string }
  | { kind: "new-watchlist" }
  | { kind: "watchlist"; name: string };

type WatchlistPlacement = {
  watchlistId: string | undefined;
  view: WatchlistViewStore;
  /** Transient quotes for sorting this session; Feed owns channel sharing. */
  quotes: StoreApi<Readonly<Record<string, Quote>>>;
  /** Open symbol search; the pick goes to that section or the first one. */
  addSymbol: (sectionId?: string) => void;
  /** Open the name dialog for a section or a Watchlist. */
  editName: (target: NameTarget) => void;
  /** Show another Watchlist in this placement. */
  switchTo: (watchlistId: string) => void;
  /** Delete the selected Watchlist; successful deletion selects another or shows an empty view. */
  deleteWatchlist: () => void;
};

/** Provided once per placement by the widget's Provider. */
export const WatchlistPlacementContext =
  createContext<WatchlistPlacement | null>(null);

/** Read the placement's Watchlist; throws outside a watchlist widget. @example const {watchlistId} = useWatchlistPlacement(); */
export function useWatchlistPlacement() {
  const value = useContext(WatchlistPlacementContext);
  if (!value) throw new Error("Watchlist content needs its widget Provider.");
  return value;
}
