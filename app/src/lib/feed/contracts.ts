// Purpose: Derive local Bars view and hook shapes from shared schemas and opaque runtime capabilities.
import {
  BarsRequest,
  BarsSnapshot,
  BarsSnapshotCheck,
  ClientFailure,
  FeedError,
} from "@openchart/feed";
import { Predicate, Schema } from "effect";
import { isObservable, type Observable } from "rxjs";

const action = Schema.declare<() => void>((value): value is () => void =>
  Predicate.isFunction(value),
);
const updates = Schema.declare<Observable<BarsSnapshot["data"]>>(
  (value): value is Observable<BarsSnapshot["data"]> => isObservable(value),
);

/** Compare request content using the shared schema. @example sameBarsRequest(a, b); */
export const sameBarsRequest = Schema.toEquivalence(BarsRequest);

/** Loading keeps the stopped view by default; clear hides it for any series/window. */
export const UseBarsOptions = Schema.Struct({
  loadingBehavior: Schema.optionalKey(Schema.Literals(["keep", "clear"])),
});
export type UseBarsOptions = typeof UseBarsOptions.Type;

/** A snapshot and replayable updates; its outer subscription owns the channel. */
export const BarsView = Schema.Struct({
  ...BarsSnapshot.fields,
  request: BarsRequest,
  updates,
}).check(BarsSnapshotCheck);
export type BarsView = typeof BarsView.Type;

const retained = Schema.Union([BarsView, Schema.Undefined]);
/** React observes window transitions, while bars are delivered directly to the renderer. */
export const UseBarsResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("loading"),
    current: retained,
    retry: action,
  }),
  Schema.Struct({
    status: Schema.Literal("ready"),
    current: BarsView,
    retry: action,
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    current: retained,
    error: Schema.Union([FeedError, ClientFailure]),
    retry: action,
  }),
]);
export type UseBarsResult = typeof UseBarsResult.Type;
