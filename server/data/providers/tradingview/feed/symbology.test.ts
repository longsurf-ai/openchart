// Purpose: Preserve complete native candidates until the merged Feed ranks and filters them.
import { Effect } from "effect";
import { expect, test } from "vitest";
import { ProviderId } from "@openchart/market";
import { makeDataset } from "@openchart/server/data/dataset/dataset";
import { makeClient } from "../client";
import { tradingviewSymbology } from "../datasets/definitions";
import { searchSymbols } from "../datasets/symbology";
import { tradingviewSymbologyFeed } from "./symbology";

test("every expanded contract, stock and currency-less index reaches the Feed unsliced", async () => {
  const hits = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeClient({
        fetch: async () =>
          Response.json({
            symbols: [
              {
                symbol: "CL",
                description: "Crude Oil Futures",
                source_id: "NYMEX",
                currency_code: "USD",
                type: "futures",
                contracts: [
                  { symbol: "CL1!", typespecs: ["continuous"] },
                  ...Array.from({ length: 124 }, (_, index) => ({
                    symbol: "CLZ" + (2026 + index),
                  })),
                ],
              },
              {
                symbol: "CL",
                description: "Colgate-Palmolive Company",
                source_id: "NYSE",
                type: "stock",
                currency_code: "USD",
              },
              {
                symbol: "CLINDEX",
                description: "Crude Oil Index",
                source_id: "INDEX",
                type: "index",
              },
            ],
          }),
      });
      const dataset = yield* makeDataset(tradingviewSymbology, {
        search: (query) => searchSymbols(client, query),
      });
      return yield* tradingviewSymbologyFeed(
        dataset,
        ProviderId.make("tradingview"),
      ).search({
        query: "CL",
        limit: 30,
        indexed: false,
      });
    }).pipe(Effect.scoped),
  );
  // One continuous and 124 dated contracts, the stock and the index; no family row.
  expect(hits).toHaveLength(127);
  expect(
    hits.find(({ listing }) => listing.symbol === "CL")?.listing,
  ).toMatchObject({ venue: "NYSE", class: "stock" });
  expect(
    hits.some(
      ({ listing }) => listing.symbol === "CL" && listing.venue === "NYMEX",
    ),
  ).toBe(false);
  expect(
    hits.find(({ listing }) => listing.symbol === "CL1!")?.listing.class,
  ).toBe("future");
  expect(
    hits.find(({ listing }) => listing.symbol === "CLINDEX")?.listing.currency,
  ).toBe("");
});
