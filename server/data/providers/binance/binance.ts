// Purpose: Own Binance's public Dataset service and scoped activation Layer.

import { Context, Effect, Layer, type Deferred } from "effect";
import {
  binanceBars,
  binanceSymbology,
} from "@openchart/server/data/providers/binance/datasets/definitions";
import { makeDataset } from "@openchart/server/data/dataset/dataset";
import { configuredDatasets } from "@openchart/server/data/providers/configured";
import { type AccessCheckedDatasetProvider } from "@openchart/server/data/provider";

import {
  cachedSelectBars,
  selectBars,
  streamBars,
} from "@openchart/server/data/providers/binance/datasets/bars";
import {
  searchSymbols,
  selectSymbols,
} from "@openchart/server/data/providers/binance/datasets/symbology";
import { config } from "./config";
import { feeds } from "@openchart/server/data/providers/binance/feed/feed";
import { chooseHost, makeClient, type BinanceOptions } from "./client";

export { config } from "./config";

/** Public Binance market data needs no API key; activations own cancellable handles. */
export class BinanceProvider extends Context.Service<
  BinanceProvider,
  AccessCheckedDatasetProvider
>()("data/providers/Binance") {
  /** Source-owned Feed bindings; construction acquires no resources. */
  static readonly feeds = feeds;

  /** Default Provider with native I/O and scoped activation.
   * @example BinanceProvider.layer;
   */
  static readonly layer = BinanceProvider.makeLayer({});

  /** Build a Provider with injected I/O or endpoints for tests.
   * @example BinanceProvider.makeLayer({ fetch: testFetch });
   */
  static makeLayer(options: BinanceOptions) {
    const acquire = Effect.fn("BinanceProvider.acquire")(function* (
      retired: Deferred.Deferred<void>,
      options: BinanceOptions,
    ) {
      // Every activation probes again; requests never wait for the probe.
      const withHost = yield* chooseHost(options);
      const bars = yield* makeDataset(binanceBars, {
        // Cached history reads through the picked host; both hosts serve the
        // same exchange data, so cached spans stay valid when it changes.
        select: (yield* cachedSelectBars((query) =>
          withHost((options) => selectBars(options, query)),
        )).select,
        stream: (query) =>
          withHost((options) => streamBars(options, query, retired)),
      });
      const symbology = yield* makeDataset(binanceSymbology, {
        select: (query) => withHost((options) => selectSymbols(options, query)),
        search: (query) => withHost((options) => searchSymbols(options, query)),
      });
      return [bars, symbology];
    });
    return Layer.effect(
      BinanceProvider,
      Effect.gen(function* () {
        const client = yield* makeClient(options.fetch);
        const limitedOptions = {
          ...options,
          fetch: client.fetch,
        };
        const checkAccess = () =>
          Effect.succeed({ status: "granted" } as const);
        const stream = yield* configuredDatasets(
          config,
          (retired) => acquire(retired, limitedOptions),
          checkAccess,
        );
        return {
          definitions: [binanceBars, binanceSymbology],
          watch: () => stream,
          checkAccess,
          refresh: () => Effect.void,
        };
      }),
    );
  }
}
