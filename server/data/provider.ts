// Purpose: Providers publish complete sets of callable Datasets and own their configuration and lifetimes.
import { Schema, type Effect, type Stream } from "effect";
import type { DatasetDefinition } from "@openchart/server/data/dataset";
import type { Dataset } from "@openchart/server/data/dataset/index";
import type { DatasetFailure } from "@openchart/server/data/dataset";

/** Access requirements are independent of configuration and transport health. */
export const ProviderAccess = Schema.Union([
  /** The user can use this provider now; Settings shows the enable switch. */
  Schema.Struct({ status: Schema.Literal("granted") }),
  /** The user must act first; Settings shows `action` instead of the switch. */
  Schema.Struct({
    status: Schema.Literal("required"),
    /** sign-in: no account is signed in, so there is no credential to check.
     * subscribe: no subscription, or it ended.
     * manage-subscription: a subscription needs fixing, e.g. past_due or paused.
     */
    action: Schema.Literals(["sign-in", "subscribe", "manage-subscription"]),
  }),
]);
/** Confirmed access facts; failed checks remain in the error channel. */
export type ProviderAccess = typeof ProviderAccess.Type;

/** Providers whose access Settings and activation check; bundled datasets need none. */
export interface AccessCheckedDatasetProvider extends IDatasetProvider {
  /** Check current access even while disabled; errors never mean unsubscribed.
   * @example yield* provider.checkAccess();
   */
  checkAccess(): Effect.Effect<ProviderAccess, DatasetFailure>;
  /** Re-evaluate activation after access may have changed, preserving enabled.
   * @example yield* provider.refresh();
   */
  refresh(): Effect.Effect<void>;
}

/** A Provider publishes only ready instances; credentials stay in its closures. */
export interface IDatasetProvider {
  readonly definitions: readonly DatasetDefinition[];
  /** Replace this Provider's contribution; [] means unavailable. Watching survives credential changes.
   * @example provider.watch().pipe(Stream.runForEach(datasets => consume(datasets)));
   */
  watch(): Stream.Stream<readonly Dataset[]>;
}
