// Purpose: Own finite reads of declared timeseries independently of where their rows are stored.
import type { Effect } from "effect";
import type { DataFrame } from "@openchart/timeseries";
import type { FeedError, SeriesRequest } from "@openchart/feed";

/** One readable series; its source assigns `id` and maps its own failures. */
export interface SeriesSource {
  readonly id: string;
  select(range: Omit<SeriesRequest, "id">): Effect.Effect<DataFrame, FeedError>;
}

/** Read any ready series by id; an id no ready source serves is unavailable. */
export interface ISeriesFeedService {
  /** Every declared column within the range. @example yield* series.select({id: "wsd_x", from: 0}); */
  select(request: SeriesRequest): Effect.Effect<DataFrame, FeedError>;
}
