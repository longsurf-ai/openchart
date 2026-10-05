// Purpose: Embed the canonical V2 market identity in the core's existing Zod records.
import { ProviderListing as MarketProviderListing } from "@openchart/market";
import { Schema } from "effect";
import { z } from "zod";

/**
 * Validates with the V2 owner schema, preserving the original provider/listing.
 * Core records retain Zod; no second listing schema or numeric ID is introduced.
 * @example ProviderListing.parse({provider: 'yahoo', listing: {symbol: 'AAPL', currency: 'USD'}});
 */
export const ProviderListing = z.custom<MarketProviderListing>(
  Schema.is(MarketProviderListing),
  "Expected a V2 provider and listing",
);
export type ProviderListing = MarketProviderListing;
