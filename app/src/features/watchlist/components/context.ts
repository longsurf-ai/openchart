// Purpose: Share one placement's Watchlist identity, view state, and dialogs between its controls and content.
import type { ProviderListing } from "@openchart/market";
import { createContext, useContext, type ComponentType } from "react";
import type { BehaviorSubject } from "rxjs";
import type { Quotes } from "../hooks/use-quote";

import type { WatchlistViewStore } from "../stores/view";
import type { FormulaSource, WatchlistSave } from "../api/queries";

/** The symbol search app composition supplies; features never import each other. */
export type SymbolPickerProps = {
  initialQuery?: string;
  onSelect: (listing: ProviderListing) => void | Promise<void>;
  onClose: () => void;
};

/** App composition provides the symbol search dialog for rows and formula inputs. */
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

/** One computed cell. An unavailable value is never interpreted as zero. */
export type FormulaValue = {
  status: "loading" | "ready" | "empty" | "error";
  value?: number;
  /** Execution and output that produced this value; changes reset presentation. */
  identity?: string;
  /** UTC milliseconds of the latest evaluated bar, when available. */
  time?: number;
  error?: string;
  retry?: () => void;
};
/** Widget-local formula results indexed by row identity, then stable column identity. */
export type FormulaValues = Readonly<
  Record<string, Readonly<Record<string, FormulaValue>>>
>;
/** Script selection belongs to app composition; this feature owns the resulting settings. */
export type FormulaPickerProps = {
  onSelect: (source: FormulaSource) => void | Promise<void>;
  onClose: () => void;
};
/** App-supplied code picker, with no dependency on another feature. */
export const WatchlistFormulaPicker =
  createContext<ComponentType<FormulaPickerProps> | null>(null);

type WatchlistPlacement = {
  watchlistId: string | undefined;
  view: WatchlistViewStore;
  save: WatchlistSave;
  /** Transient quotes for sorting this session; Feed owns channel sharing. */
  quotes: BehaviorSubject<Quotes>;
  /** The Price History instant under the pointer in Unix ms, shared by every row; null when none. */
  crosshair: BehaviorSubject<number | null>;
  formulaValues: BehaviorSubject<FormulaValues>;
  addFormula: () => void;
  configureFormula: (columnId: string) => void;
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
