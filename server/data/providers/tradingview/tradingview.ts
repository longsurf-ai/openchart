// Purpose: Publish TradingView Datasets anonymously or under a stored cookie session.

import {
  Context,
  Effect,
  Layer,
  Stream,
  SubscriptionRef,
  type Deferred,
} from "effect";
import {
  tradingviewBars,
  tradingviewSymbology,
} from "@openchart/server/data/providers/tradingview/datasets/definitions";
import { makeDataset } from "@openchart/server/data/dataset/dataset";
import { configuredDatasets } from "@openchart/server/data/providers/configured";
import type { AccessCheckedDatasetProvider } from "@openchart/server/data/provider";
import { feeds } from "@openchart/server/data/providers/tradingview/feed/feed";
import { selectBars, streamBars } from "./datasets/bars";
import { searchSymbols } from "./datasets/symbology";
import { makeCredential } from "./access";
import { makeClient, type ClientOptions } from "./client";
import { config } from "./config";

export { config } from "./config";

/** TradingView chart data; cookies in Access optionally raise its history depth.
 * @example TradingViewProvider.layer;
 */
export class TradingViewProvider extends Context.Service<
  TradingViewProvider,
  AccessCheckedDatasetProvider
>()("data/providers/TradingView") {
  /** Source-owned Feed bindings; construction acquires no resources. */
  static readonly feeds = feeds;

  /** Default Provider with TradingView's public endpoints.
   * @example TradingViewProvider.layer;
   */
  static readonly layer = TradingViewProvider.makeLayer({});

  /** Build a Provider with injected transport for tests.
   * @example TradingViewProvider.makeLayer({fetch: testFetch, websocket: testSocket});
   */
  static makeLayer(options: Omit<ClientOptions, "credential"> = {}) {
    return Layer.effect(
      TradingViewProvider,
      Effect.gen(function* () {
        const credential = yield* makeCredential;
        const client = yield* makeClient({ ...options, credential });
        const changes = yield* SubscriptionRef.make(0);
        const acquire = Effect.fn("TradingViewProvider.acquire")(function* (
          retired: Deferred.Deferred<void>,
        ) {
          const bars = yield* makeDataset(tradingviewBars, {
            select: (query) => selectBars(client, query),
            stream: (query) => streamBars(client, query, retired),
          });
          const symbology = yield* makeDataset(tradingviewSymbology, {
            search: (query) => searchSymbols(client, query),
          });
          return [bars, symbology];
        });
        const configured = yield* configuredDatasets(
          config,
          acquire,
          client.access,
        );
        return {
          definitions: [tradingviewBars, tradingviewSymbology],
          // A refresh rebuilds ready Datasets so a changed session is revalidated.
          watch: () =>
            SubscriptionRef.changes(changes).pipe(
              Stream.map(() => undefined),
              Stream.switchMap(() => configured),
            ),
          checkAccess: client.access,
          refresh: () =>
            client
              .reset()
              .pipe(
                Effect.andThen(
                  SubscriptionRef.update(changes, (value) => value + 1),
                ),
              ),
        };
      }),
    );
  }
}
