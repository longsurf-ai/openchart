// Purpose: Own Yahoo's TypeScript Dataset service, activation, and delayed polling.

import { Context, Effect, Layer, type Deferred } from "effect";
import {
  yfinanceBars,
  yfinanceSymbology,
} from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { makeDataset } from "@openchart/server/data/dataset/dataset";
import { configuredDatasets } from "@openchart/server/data/providers/configured";
import { type AccessCheckedDatasetProvider } from "@openchart/server/data/provider";

import {
  cachedSelectBars,
  streamBars,
} from "@openchart/server/data/providers/yfinance/datasets/bars";
import { cachedSearchSymbols } from "@openchart/server/data/providers/yfinance/datasets/symbology";
import { config } from "./config";
import { feeds } from "@openchart/server/data/providers/yfinance/feed/feed";
import { makeClient, type YFinanceOptions } from "./client";

export { config } from "./config";

/** Yahoo chart/search use public HTTP endpoints; polling never implies exchange real time. */
export class YFinanceProvider extends Context.Service<
  YFinanceProvider,
  AccessCheckedDatasetProvider
>()("data/providers/YFinance") {
  /** Source-owned Feed bindings; construction acquires no resources. */
  static readonly feeds = feeds;

  /** Default Provider with native fetch polling and scoped activation.
   * @example YFinanceProvider.layer;
   */
  static readonly layer = YFinanceProvider.makeLayer({});

  /** Build a Provider with injected I/O or polling cadence for tests.
   * @example YFinanceProvider.makeLayer({ fetch: testFetch });
   */
  static makeLayer(options: YFinanceOptions) {
    const acquire = Effect.fn("YFinanceProvider.acquire")(function* (
      retired: Deferred.Deferred<void>,
      options: YFinanceOptions,
    ) {
      const bars = yield* makeDataset(yfinanceBars, {
        select: (yield* cachedSelectBars(options)).select,
        stream: (query) => streamBars(options, query, retired),
      });
      const symbology = yield* makeDataset(yfinanceSymbology, {
        search: (yield* cachedSearchSymbols(options)).search,
      });
      return [bars, symbology];
    });
    return Layer.effect(
      YFinanceProvider,
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
          definitions: [yfinanceBars, yfinanceSymbology],
          watch: () => stream,
          checkAccess,
          refresh: () => Effect.void,
        };
      }),
    );
  }
}
