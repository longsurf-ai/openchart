// Purpose: Derive local Bars view and hook shapes from shared schemas and opaque runtime capabilities.
import {
  BarsRequest,
  BarsSnapshot,
  ClientFailure,
  FeedError,
} from "@openchart/feed";
import { Predicate, Schema } from "effect";
import { isObservable, type Observable } from "rxjs";

const RetryAction = Schema.declare<() => void>((value): value is () => void =>
  Predicate.isFunction(value),
);
const BarsUpdates = Schema.declare<Observable<BarsSnapshot["data"]>>(
  (value): value is Observable<BarsSnapshot["data"]> => isObservable(value),
);

/** Compare request content using the shared schema. @example sameBarsRequest(a, b); */
export const sameBarsRequest = Schema.toEquivalence(BarsRequest);

/** Loading keeps the stopped view by default; clear hides it for any series/window. */
export const UseBarsOptions = Schema.Struct({
  loadingBehavior: Schema.optionalKey(Schema.Literals(["keep", "clear"])),
});
export type UseBarsOptions = typeof UseBarsOptions.Type;

/**
 * An immutable snapshot and compacted updates, owned by the outer subscription.
 * Late readers receive the latest revision of each updated bar in one batch, then
 * original live batches. Intermediate revisions are not a historical tick log.
 */
export const BarsView = BarsSnapshot.mapFields(
  (fields) => ({
    ...fields,
    request: BarsRequest,
    updates: BarsUpdates,
  }),
  { unsafePreserveChecks: true }, // Snapshot fields are unchanged.
);
export type BarsView = typeof BarsView.Type;

const RetainedBarsView = Schema.Union([BarsView, Schema.Undefined]);
/** React observes window transitions, while bars are delivered directly to the renderer. */
export const UseBarsResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("loading"),
    current: RetainedBarsView,
    retry: RetryAction,
  }),
  Schema.Struct({
    status: Schema.Literal("ready"),
    current: BarsView,
    retry: RetryAction,
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    current: RetainedBarsView,
    error: Schema.Union([FeedError, ClientFailure]),
    retry: RetryAction,
  }),
]);
export type UseBarsResult = typeof UseBarsResult.Type;
