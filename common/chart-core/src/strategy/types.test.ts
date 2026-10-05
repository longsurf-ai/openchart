// Purpose: Lock strategy return derivation for long and short execution fills
// Module:  @openchart/chart-core / strategy

import { describe, expect, it } from "vitest";
import { Strategy } from "./types";
import { closedTradeExitSummary } from "./render";

describe("Strategy.closedTradeMetrics", () => {
  it("derives the NVDA long return and ending capital from fills", () => {
    const trade = Strategy.ClosedTrade.parse({
      id: "trade-nvda-reclaim",
      orderId: "Long",
      direction: "long",
      status: "closed",
      entry: { time: 1775707200, price: 181.84 },
      exit: { time: 1778817600, price: 229.76 },
    });

    const result = Strategy.closedTradeMetrics(trade, 10_000);

    expect(result.returnFraction).toBeCloseTo(0.2635283766, 8);
    expect(result.endingCapital).toBeCloseTo(12_635.283766, 5);
  });

  it("inverts the price return for a short trade", () => {
    const trade = Strategy.ClosedTrade.parse({
      id: "trade-short",
      orderId: "Short",
      direction: "short",
      status: "closed",
      entry: { time: 1, price: 100 },
      exit: { time: 2, price: 80 },
    });

    expect(Strategy.closedTradeMetrics(trade, 1_000)).toEqual({
      returnFraction: 0.2,
      endingCapital: 1_200,
    });
  });

  it("puts derived profit and duration into the exit callout", () => {
    const trade = Strategy.ClosedTrade.parse({
      id: "trade-nvda-reclaim",
      orderId: "Long",
      direction: "long",
      status: "closed",
      entry: { time: 1775707200, price: 181.84 },
      exit: { time: 1778817600, price: 229.76 },
    });

    expect(closedTradeExitSummary(trade, 10_000, 26)).toBe(
      "+26.4% · 26 sessions",
    );
  });
});
