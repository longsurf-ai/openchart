// Purpose: Keep provider identity and draft/record boundaries on V2 market assumptions.
import { describe, expect, it } from "vitest";
import {
  ChartAnnotation,
  createDraftAnnotationRecord,
} from "@openchart/chart-core/annotation";
import { ProviderListing } from "./provider-listing";

import { Schema } from "effect";
describe("V2 market identity", () => {
  const market = ProviderListing.parse({
    provider: "yahoo",
    listing: { symbol: "AAPL", currency: "USD" },
  });

  it("accepts listings without numeric IDs and rejects bare or V1 identities", () => {
    expect(ProviderListing.parse(market)).toBe(market);
    expect(ProviderListing.safeParse(market.listing).success).toBe(false);
    expect(
      ProviderListing.safeParse({ listing_id: 1, display_symbol: "AAPL" })
        .success,
    ).toBe(false);
  });

  it("draws a draft without inventing a listing but requires identity on a stored record", () => {
    const draft = createDraftAnnotationRecord({
      id: "draft",
      label: "Note",
      anchor: { start: Date.parse("2026-09-15") / 1000 },
    });
    expect(draft).not.toHaveProperty("market");
    expect(Schema.is(ChartAnnotation.Record)(draft)).toBe(false);
    expect(
      Schema.decodeUnknownSync(ChartAnnotation.Record)({ ...draft, market })
        .market,
    ).toEqual(market);
  });
});
