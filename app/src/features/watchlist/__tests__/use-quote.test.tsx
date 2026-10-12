// Purpose: Live quotes use corrected daily bars and release session-local sorting state.
import { defineDataFrame } from "@openchart/timeseries";
import { BarColumns } from "@openchart/market";
import type { BarsRequest } from "@openchart/feed";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Subject, BehaviorSubject } from "rxjs";

import type { BarsView } from "@openchart/app/hooks/use-bars";
import { WatchlistPlacementContext } from "../components/context";
import { useLiveQuote, useSortQuotes, type Quote } from "../hooks/use-quote";
import type { WatchlistSave } from "../api/queries";
import { createWatchlistViewStore } from "../stores/view";

const { useBars } = vi.hoisted(() => ({ useBars: vi.fn() }));
vi.mock("@openchart/app/hooks/use-bars", () => ({ useBars }));

afterEach(() => {
  vi.useRealTimers();
});

const Bars = defineDataFrame(BarColumns);
const frame = (rows: Array<{ time: number; close: number; volume: number }>) =>
  Bars.create({
    labels: {},
    rows: rows.map((row) => ({
      open: row.close,
      high: row.close,
      low: row.close,
      ...row,
    })),
  });

test("corrects the previous close, rolls to a new day, and keeps other sessions independent", () => {
  vi.useFakeTimers();
  const updates = new Subject<BarsView["data"]>();
  useBars.mockReturnValue({
    status: "ready",
    current: {
      data: frame([
        { time: 1, close: 100, volume: 10 },
        { time: 2, close: 110, volume: 20 },
      ]),
      updates,
    },
  });
  const request = {
    provider: "yfinance",
    listing: { symbol: "AAPL", currency: "USD" },
    resolution: "1d",
    session: "regular",
    adjustment: "raw",
    from: 0,
    to: "now",
  } as BarsRequest;
  const mount = () => {
    const quotes = new BehaviorSubject<Readonly<Record<string, Quote>>>({});
    const value = {
      quotes,
      crosshair: new BehaviorSubject<number | null>(null),
      formulaValues: new BehaviorSubject({}),
      addFormula: vi.fn(),
      configureFormula: vi.fn(),
      save: {} as WatchlistSave,
      view: createWatchlistViewStore(crypto.randomUUID()),
      watchlistId: "wtl_test",
      addSymbol: vi.fn(),
      openDialog: vi.fn(),
      switchTo: vi.fn(),
    };
    const view = renderHook(
      () => ({ ...useLiveQuote(request, "aapl"), sorted: useSortQuotes(true) }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <WatchlistPlacementContext.Provider value={value}>
            {children}
          </WatchlistPlacementContext.Provider>
        ),
      },
    );
    return { ...view, quotes };
  };
  const first = mount();
  const second = mount();
  expect(first.result.current.quote).toEqual({
    price: 110,
    change: 10,
    changePercent: 10,
    volume: 20,
    previousClose: 100,
  });
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(first.result.current.sorted.aapl?.price).toBe(110);
  act(() => updates.next(frame([{ time: 1, close: 105, volume: 10 }])));
  expect(first.result.current.quote?.change).toBe(5);
  act(() => updates.next(frame([{ time: 3, close: 121, volume: 30 }])));
  expect(first.quotes.value.aapl).toEqual({
    price: 121,
    change: 11,
    changePercent: 10,
    volume: 30,
    previousClose: 110,
  });
  expect(first.result.current.sorted.aapl?.price).toBe(110);
  act(() => {
    vi.advanceTimersByTime(249);
  });
  expect(first.result.current.sorted.aapl?.price).toBe(110);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(first.result.current.sorted.aapl?.price).toBe(121);
  first.unmount();
  expect(first.quotes.value).toEqual({});
  expect(second.quotes.value.aapl?.price).toBe(121);
  expect(updates.observed).toBe(true);
  useBars.mockReturnValue({
    ...useBars.mock.results[0]!.value,
    status: "error",
    error: new Error("offline"),
  });
  second.rerender();
  expect(second.result.current.quote).toBeUndefined();
  expect(second.quotes.value.aapl).toEqual({});
  second.unmount();
  expect(updates.observed).toBe(false);
});
