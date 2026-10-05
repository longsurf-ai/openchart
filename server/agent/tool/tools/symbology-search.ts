// Purpose: Exposes the shared Symbology Feed to Agent tools without changing listing identity.

import { SymbolSearchRequest } from "@openchart/feed";
import * as Tool from "@openchart/server/agent/tool/tool";
import { Feed } from "@openchart/server/feed/service";
import { Effect, Schema } from "effect";

/** Model-facing batch; each query uses the shared Feed search contract. */
export const Parameters = Schema.Struct({
  queries: Schema.Array(SymbolSearchRequest.fields.query).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(10),
  ),
  limit: SymbolSearchRequest.fields.limit,
  assetClass: SymbolSearchRequest.fields.assetClass,
}).annotate({ parseOptions: { onExcessProperty: "error" } });

/**
 * Searches each query against the current Feed after one permission check. Results
 * retain input order and provider identity; each query has its own limit. Feed
 * failures and cancellation propagate unchanged. Initialization captures no Feed.
 * @example
 * const tool = yield* Tool.init(yield* SymbologySearchTool);
 * yield* tool.execute({queries: ['AAPL', 'MSFT'], limit: 5}, context);
 */
export const SymbologySearchTool = Tool.define(
  "symbology_search",
  Effect.succeed({
    description:
      "Search current market data providers by up to 10 ticker or company-name queries. Supply a nonempty queries array and a positive integer limit per query; optionally filter by assetClass. Returns an array in query order, each {query, listings} with ProviderListing objects ({provider, listing}). Preserve both provider and listing: symbols and listing IDs belong to their provider, and results from different providers are not merged into one security. No matches for a query returns an empty listings array; an unavailable or failed source fails the whole call.",
    parameters: Parameters,
    execute: Effect.fn("SymbologySearch.execute")(function* (
      input: typeof Parameters.Type,
      context: Tool.Context,
    ) {
      yield* context.ask({
        permission: "symbology_search",
        patterns: input.queries,
        always: ["*"],
        metadata: input,
      });
      const { queries, ...searchOptions } = input;
      const services = yield* (yield* Feed).get();
      const results = yield* Effect.forEach(queries, (query) =>
        services.symbology
          .search({ ...searchOptions, query, indexed: true })
          .pipe(Effect.map((listings) => ({ query, listings }))),
      );
      return {
        title: "Search symbols",
        metadata: {},
        output: { type: "json" as const, value: results },
      };
    }),
  }),
);
