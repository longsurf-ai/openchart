// Purpose: Share one placement's Watchlist identity, view state, and dialogs between its controls and content.
import type { ProviderListing } from "@openchart/market";
import { createContext, useContext, type ComponentType } from "react";
import type { BehaviorSubject } from "rxjs";
import type { Quotes } from "../hooks/use-quote";

import type { WatchlistViewStore } from "../stores/view";
import type { WatchlistSave } from "../api/queries";

/** The symbol search app composition supplies; features never import each other. */
export type SymbolPickerProps = {
  onSelect: (listing: ProviderListing) => void | Promise<void>;
  onClose: () => void;
};

/** App composition provides the symbol search dialog for adding rows. */
export const WatchlistSymbolPicker =
  createContext<ComponentType<SymbolPickerProps> | null>(null);

/** Naming or deletion actions handled by the placement dialog. */
export type WatchlistAction =
  | { kind: "new-section"; parentId?: string }
  | { kind: "section"; sectionId: string; name?: string }
  | { kind: "new-watchlist" }
  | { kind: "watchlist"; name: string }
  | { kind: "delete-watchlist"; name: string }
  | { kind: "delete-section"; sectionId: string; name?: string };

type WatchlistPlacement = {
  watchlistId: string | undefined;
  view: WatchlistViewStore;
  save: WatchlistSave;
  /** Transient quotes for sorting this session; Feed owns channel sharing. */
  quotes: BehaviorSubject<Quotes>;
  /** Open symbol search; the pick goes to that section or the first one. */
  addSymbol: (sectionId?: string) => void;
  /** Open a naming or deletion dialog for a section or Watchlist. */
  openDialog: (target: WatchlistAction) => void;
  /** Show another Watchlist in this placement. */
  switchTo: (watchlistId: string) => void;
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
