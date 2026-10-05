// Purpose: Register data Providers and their Feed bindings once for application composition.
import { Effect, Layer, Schema, Struct } from "effect";
import { BinanceProvider } from "@openchart/server/data/providers/binance/binance";
import { YFinanceProvider } from "@openchart/server/data/providers/yfinance/yfinance";
import { OpenChartProvider } from "@openchart/server/data/providers/openchart/openchart";
import { LogosProvider } from "@openchart/server/data/providers/local/logos/logos";
export { BinanceProvider, YFinanceProvider, OpenChartProvider, LogosProvider };

const providers = [
  BinanceProvider,
  YFinanceProvider,
  OpenChartProvider,
  LogosProvider,
] as const;

/** Ready Provider services; application composition supplies their shared dependencies. */
export const dataProviders = Effect.all(providers);

const accessChecked = {
  binance: BinanceProvider,
  yfinance: YFinanceProvider,
  openchart: OpenChartProvider,
};
/** Access-checked Providers by Settings ID, independent of ready datasets. */
export const accessCheckedDataProviders = Effect.all(accessChecked);
/** Settings IDs of access-checked Providers. */
export const AccessCheckedProviderId = Schema.Literals(
  Struct.keys(accessChecked),
);

/** Static Layers own Provider activation, independent of Feed provisioning. */
export const dataProviderLayer = Layer.mergeAll(
  Layer.empty,
  ...providers.map((provider) => provider.layer),
);
/** All source-specific adaptation is supplied by the registered Providers. */
export const providerFeeds = providers.map((provider) => provider.feeds);
