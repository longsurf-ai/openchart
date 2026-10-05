// Purpose: Own identifier-to-logo resolution independently of storage and transport.
import type { Effect } from "effect";
import type { LogoRequest, LogoResult, FeedError } from "@openchart/feed";

/** Resolve one canonical logo, preserving failure separately from no match. */
export interface ILogosFeedService {
  /** Ambiguous or unknown identifiers return null. @example yield* logos.getLogo({identifier: "BTC"}); */
  getLogo(request: LogoRequest): Effect.Effect<LogoResult, FeedError>;
}
