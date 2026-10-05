// Purpose: Share one chart grid's identity, mounted handles, and cell interactions.
import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { useChartSelection } from "@openchart/app/hooks/use-chart-selection";

import type { ChartPreferencesStore } from "./preferences";
import type { ChartRuntime } from "./store";

/** A cell owns both handles; the grid only registers them while it is mounted. */
export interface MountedChart {
  readonly chart: ChartRuntime;
  readonly preferences: ChartPreferencesStore;
}

/** Resource values stay in Query; this context contains only identity and UI capabilities. */
export interface ChartGridContextValue {
  readonly chartId: string;
  readonly transport: AppTransport;
  readonly focusedId: string | undefined;
  readonly setFocused: (id: string) => void;
  readonly maximizedId: string | undefined;
  readonly toggleMaximized: (id: string) => void;
  readonly mounted: ReadonlyMap<string, MountedChart>;
  readonly register: (
    chart: ChartRuntime,
    preferences: ChartPreferencesStore,
  ) => () => void;
}

/** Mounted cells and grid controls share local interactions, never Resource snapshots. */
export const ChartGridContext = createContext<
  ChartGridContextValue | undefined
>(undefined);

/** Key by Resource ID so interactions end when the user changes layouts. @example <ChartGridProvider key={chartId} chartId={chartId} transport={transport}>{children}</ChartGridProvider> */
export function ChartGridProvider({
  chartId,
  transport,
  children,
}: Pick<ChartGridContextValue, "chartId" | "transport"> & {
  children: ReactNode;
}) {
  const { focusedCells, focus } = useChartSelection();
  const focusedId = focusedCells[chartId];
  const setFocused = useCallback(
    (cellId: string) => focus(chartId, cellId),
    [chartId, focus],
  );
  const [maximizedId, setMaximized] = useState<string>();
  const [mounted, setMounted] = useState<ReadonlyMap<string, MountedChart>>(
    () => new Map(),
  );
  const toggleMaximized = useCallback((id: string) => {
    setMaximized((previous) => (previous === id ? undefined : id));
  }, []);
  const register = useCallback(
    (chart: ChartRuntime, preferences: ChartPreferencesStore) => {
      const handle = { chart, preferences };
      setMounted((previous) => new Map(previous).set(chart.id, handle));
      return () => {
        setMaximized((current) => (current === chart.id ? undefined : current));
        setMounted((previous) => {
          if (previous.get(chart.id) !== handle) return previous;
          const next = new Map(previous);
          next.delete(chart.id);
          return next;
        });
      };
    },
    [],
  );
  const value = useMemo(
    () => ({
      chartId,
      transport,
      focusedId,
      setFocused,
      maximizedId,
      toggleMaximized,
      mounted,
      register,
    }),
    [
      chartId,
      transport,
      focusedId,
      setFocused,
      maximizedId,
      toggleMaximized,
      mounted,
      register,
    ],
  );
  return (
    <ChartGridContext.Provider value={value}>
      {children}
    </ChartGridContext.Provider>
  );
}
