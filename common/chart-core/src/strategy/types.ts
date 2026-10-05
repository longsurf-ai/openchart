// Purpose: Runtime strategy execution schemas; performance remains derived from immutable fills
// Module:  @openchart/chart-core / strategy

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Schema } from "effect";
import { Data } from "@openchart/chart-core/data";

export namespace Strategy {
  export const Fill = z.object({
    time: z.custom<Data.Time>(Schema.is(Data.Time)),
    price: z.number().finite().positive(),
  });
  export type Fill = z.infer<typeof Fill>;

  const TradeBase = z.object({
    id: z.string().min(1),
    orderId: z.string().min(1),
    direction: z.enum(["long", "short"]),
    entry: Fill,
  });

  export const OpenTrade = TradeBase.extend({
    status: z.literal("open"),
  });
  export type OpenTrade = z.infer<typeof OpenTrade>;

  export const ClosedTrade = TradeBase.extend({
    status: z.literal("closed"),
    exit: Fill,
  });
  export type ClosedTrade = z.infer<typeof ClosedTrade>;

  export const Trade = z.discriminatedUnion("status", [OpenTrade, ClosedTrade]);
  export type Trade = z.infer<typeof Trade>;

  export const State = z.object({
    name: z.string().min(1),
    initialCapital: z.number().finite().positive(),
    trades: z.array(Trade),
  });
  export type State = z.infer<typeof State>;

  export type ClosedTradeMetrics = {
    returnFraction: number;
    endingCapital: number;
  };

  export function closedTradeMetrics(
    trade: ClosedTrade,
    initialCapital: number,
  ): ClosedTradeMetrics {
    const priceReturn =
      (trade.exit.price - trade.entry.price) / trade.entry.price;
    const returnFraction =
      trade.direction === "long" ? priceReturn : -priceReturn;
    return {
      returnFraction,
      endingCapital: initialCapital * (1 + returnFraction),
    };
  }
}
