// Purpose: Provider-scoped listing identity and instrument reference values.

import { Schema } from "effect";

/** Identifies a source without claiming cross-provider listing equivalence. */
export const ProviderId = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("ProviderId"),
);
export type ProviderId = typeof ProviderId.Type;

/** Consumer asset categories. */
export const AssetClass = Schema.Literals([
  "stock",
  "etf",
  "fund",
  "crypto",
  "future",
  "forex",
  "commodity",
  "option",
  "prediction",
  "index",
  "bond",
  "basket",
  "other",
]);
export type AssetClass = typeof AssetClass.Type;

/** Optional company detail attached to an instrument. */
export const Company = Schema.Struct({
  id: Schema.Finite, // provider-scoped numeric id; some providers have none
  gvkey: Schema.optionalKey(Schema.String), // gvkey from CRSP
  cik: Schema.optionalKey(Schema.Finite), // cik from SEC
  legalName: Schema.String, // legal name of the company
  displayName: Schema.String, // display name of the company
  sic: Schema.optionalKey(Schema.String), // Standard Industrial Classification code
  naics: Schema.optionalKey(Schema.String), // North American Industry Classification System code
  sector: Schema.optionalKey(Schema.String), // industry sector
  industry: Schema.optionalKey(Schema.String), // industry group
});
export type Company = typeof Company.Type;

/** Source-native instrument identity and available reference identifiers. */
export const Instrument = Schema.Struct({
  id: Schema.String, // provider-scoped numeric id; some providers have none
  figi: Schema.optionalKey(Schema.String), // Financial Instrument Global Identifier
  isin: Schema.optionalKey(Schema.String), // International Securities Identification Number
  cusip: Schema.optionalKey(Schema.String), // Cusip Number
  company: Schema.optionalKey(Company),
});
export type Instrument = typeof Instrument.Type;

/** A source-native listed instrument; identity is meaningful only with its provider. */
export const Listing = Schema.Struct({
  id: Schema.optionalKey(Schema.Finite), // provider-scoped numeric id; some providers have none
  symbol: Schema.String, // provider-scoped symbol of the listing
  name: Schema.optionalKey(Schema.String), // human readable name
  class: Schema.optionalKey(AssetClass), // asset class of the listing
  venue: Schema.optionalKey(Schema.String), // venue name within the provider
  currency: Schema.String, // currency of the listing, required
  mic: Schema.optionalKey(Schema.String), // ISO 10383 venue id
  instrument: Schema.optionalKey(Instrument),
});
export type Listing = typeof Listing.Type;

/** The complete identity consumers pass around: a listing is meaningful only with its provider. */
export const ProviderListing = Schema.Struct({
  provider: ProviderId,
  listing: Listing,
});
export type ProviderListing = typeof ProviderListing.Type;

// Specialized Listings

/** Option terms added to a native listing. */
export const OptionListing = Schema.Struct({
  ...Listing.fields,
  class: Schema.Literal("option"), // option class
  expiration: Schema.String, // option expiration date
  strike: Schema.Finite, // option strike price
  type: Schema.Literals(["call", "put"]), // option type
  style: Schema.Literals(["american", "european"]), // option style
});

/** Spot crypto listing and base asset. */
export const CryptoSpotListing = Schema.Struct({
  ...Listing.fields,
  class: Schema.Literal("crypto"), // crypto class
  market: Schema.Literal("spot"), // crypto market type
  baseAsset: Schema.String, // base asset of the crypto listing
});

/** Stock listing specialization. */
export const EquityListing = Schema.Struct({
  ...Listing.fields,
  class: Schema.Literal("stock"),
});

/** Index listing specialization. */
export const IndexListing = Schema.Struct({
  ...Listing.fields,
  class: Schema.Literal("index"),
});
