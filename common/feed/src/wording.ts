// Purpose: The one wording function for Feed failures; imports only types so every failure class can use it.

import type { ProviderId } from "@openchart/market";
import type { ClientFailure, FeedReason } from "./errors";

const providerNames: Readonly<Record<string, string>> = {
  openchart: "OpenChart Cloud",
  yfinance: "Yahoo Finance",
  binance: "Binance",
};

/**
 * Display name of a data provider, falling back to its id for unknown providers.
 *
 * @example providerName(ProviderId.make("yfinance")); // "Yahoo Finance"
 */
export function providerName(provider: ProviderId): string {
  return providerNames[provider] ?? provider;
}

const day = (time: number) => new Date(time).toISOString().slice(0, 10);

const sentences = {
  "Feed.InvalidRequest": (failure) => failure.detail,
  "Feed.Unsupported": (failure) =>
    `${providerName(failure.provider)} doesn't provide this resolution, session and adjustment.`,
  "Feed.HistoryUnavailable": (failure) =>
    `${providerName(failure.provider)} only keeps this data from ${day(failure.availableFrom)}.`,
  "Feed.NotFound": (failure) =>
    `${providerName(failure.provider)} doesn't have this symbol.`,
  "Feed.AccessDenied": (failure) =>
    `${providerName(failure.provider)} denied access.`,
  "Feed.RateLimited": (failure) =>
    `${providerName(failure.provider)} is limiting requests. Try again in a moment.`,
  "Feed.SourceUnavailable": (failure) =>
    failure.provider === undefined
      ? "No data source is available right now."
      : `${providerName(failure.provider)} is unavailable right now.`,
  "Feed.InvalidSourceData": (failure) =>
    `${providerName(failure.provider)} returned data that couldn't be read.`,
  "Feed.ResyncRequired": (failure) =>
    `The live connection to ${providerName(failure.provider)} needs to restart.`,
  "Feed.Reconfigured": (failure) =>
    `${providerName(failure.provider)} was reconfigured. Load the data again.`,
  "Client.Cancelled": () => "The request was cancelled.",
  "Client.Disconnected": () => "The connection to the data service was lost.",
  "Client.InvalidResponse": () =>
    "The data service returned a response that couldn't be read.",
  "Client.Internal": () => "Something went wrong while loading data.",
} satisfies {
  readonly [T in (FeedReason | ClientFailure)["_tag"]]: (
    failure: Extract<FeedReason | ClientFailure, { _tag: T }>,
  ) => string;
};

/**
 * The one sentence a person sees for a Feed failure. Every consumer uses it:
 * app toasts, the agent's tool feedback, Tea `upstream` and alert health.
 * Guidance adds its own copy on top; it never rewrites this sentence.
 *
 * @example describeFailure(new FeedReasons.RateLimited({ provider }));
 */
export function describeFailure(failure: FeedReason | ClientFailure): string {
  const sentence = sentences[failure._tag] as (
    failure: FeedReason | ClientFailure,
  ) => string;
  return sentence(failure);
}
