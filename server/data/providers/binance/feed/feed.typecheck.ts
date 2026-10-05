// Purpose: Bars adaptation requires the exact provider contract and the market Bar vocabulary.
import type { Schema } from "effect";
import type { SelectResult } from "@openchart/server/data/dataset";
import type { BarsSnapshot } from "@openchart/feed";
import type { ProviderId } from "@openchart/market";
import type { DataFrame } from "@openchart/timeseries";
import type { Dataset } from "@openchart/server/data";
import type {
  binanceBars,
  binanceSymbology,
} from "@openchart/server/data/providers/binance/datasets/definitions";
import type { yfinanceBars } from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { binanceBarsFeed } from "./bars";
import { yfinanceBarsFeed } from "@openchart/server/data/providers/yfinance/feed/bars";
import { datasetAdapter } from "@openchart/server/feed/adapter";
function contracts(
  bars: Dataset<typeof binanceBars>,
  symbols: Dataset<typeof binanceSymbology>,
  yahoo: Dataset<typeof yfinanceBars>,
  id: ProviderId,
) {
  binanceBarsFeed(bars, id);
  // @ts-expect-error binding a declaration to another source's adapter is invalid
  datasetAdapter(bars.definition, (dataset) => yfinanceBarsFeed(dataset, id));
  // @ts-expect-error search cannot provide Bars
  binanceBarsFeed(symbols, id);
  // @ts-expect-error provider semantics differ even with OHLCV fields
  binanceBarsFeed(yahoo, id);
}
void contracts;
function vocabulary(
  native: SelectResult<typeof binanceBars>,
  partial: DataFrame<{ close: typeof Schema.Finite }>,
) {
  const accepted: BarsSnapshot["data"] = native;
  // @ts-expect-error a source without every Bar column cannot serve Bars
  const rejected: BarsSnapshot["data"] = partial;
  void [accepted, rejected];
}
void vocabulary;
