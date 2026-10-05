// Purpose: Defines the local Billing API and the cloud billing response contract.

export * as Billing from "./billing";

import type { Integration } from "@openchart/server/access/integration";
import { Context, type Effect, Schema, Option } from "effect";
import type { OperationFailed } from "./errors";

export { OperationFailed } from "./errors";

/** Billing period selected for an OpenChart plan. */
export const Interval = Schema.Literals(["month", "year"]);
/** Supported recurring billing period. */
export type Interval = typeof Interval.Type;

const Timestamp = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      value.endsWith("Z") &&
      Option.isSome(
        Schema.decodeUnknownOption(Schema.DateTimeUtcFromString)(value),
      ),
    { message: "Expected a UTC ISO timestamp" },
  ),
);

/**
 * Display summary of the account's OpenChart subscription, sourced from Stripe.
 * `none` means the cloud confirmed there is no subscription; authentication,
 * network, and provider failures belong in the Effect error channel.
 * This summary does not authorize access to paid backend features.
 */
export const Subscription = Schema.Union([
  Schema.Struct({ status: Schema.Literal("none") }),
  Schema.Struct({
    status: Schema.Literals([
      "trialing",
      "active",
      "past_due",
      "unpaid",
      "paused",
      "canceled",
      "incomplete",
      "incomplete_expired",
    ]),
    planId: Schema.NonEmptyString,
    interval: Interval,
    /** UTC ISO timestamps returned by the cloud billing API. */
    currentPeriodStart: Timestamp,
    currentPeriodEnd: Timestamp,
    /** Scheduled cancellation; true does not mean the subscription has ended. */
    cancelAtPeriodEnd: Schema.Boolean,
    cancelAt: Schema.NullOr(Timestamp),
  }),
]);
/** Confirmed subscription display state, without credentials or payment data. */
export type Subscription = typeof Subscription.Type;

/** Cloud access is independent of the Stripe plan; a gift never changes `none`. */
export const CloudAccess = Schema.Struct({
  canAccess: Schema.Boolean,
  complimentaryAccessUntil: Schema.NullOr(Timestamp),
});
/** Access summary; the Cloud data service still enforces admission. */
export type CloudAccess = typeof CloudAccess.Type;

const ReferralCode = Schema.String.check(Schema.isPattern(/^[A-Fa-f0-9]{6}$/));
/** Lifetime invitation codes owned by the current account, with no recipient identity. */
export const Referrals = Schema.Struct({
  canInvite: Schema.Boolean,
  codes: Schema.Array(
    Schema.Struct({ code: ReferralCode, redeemed: Schema.Boolean }),
  ),
  redeemedCode: Schema.NullOr(ReferralCode),
});
/** Current-account invitation summary. */
export type Referrals = typeof Referrals.Type;
/** A code to redeem; the Cloud determines both account identities. */
export const RedeemReferralInput = Schema.Struct({ code: ReferralCode });
/** Current-account invitation redemption input. */
export type RedeemReferralInput = typeof RedeemReferralInput.Type;

/**
 * Purchase selection. The cloud resolves the permitted Stripe price and amount
 * from this selection; the cloud determines account identity by verifying the Integration credential.
 */
export const CheckoutInput = Schema.Struct({
  planId: Schema.NonEmptyString,
  interval: Interval,
});
/** Plan and billing period requested for checkout. */
export type CheckoutInput = typeof CheckoutInput.Type;

/**
 * Short-lived Stripe-hosted page link returned through the cloud billing API.
 * The transport must validate the HTTPS destination before returning it.
 * The platform opens the link in the system browser; do not persist or log it.
 */
export const HostedLink = Schema.Struct({
  url: Schema.String.check(
    Schema.makeFilter(
      (value) => {
        const url = Schema.decodeUnknownOption(Schema.URLFromString)(value);
        return (
          Option.isSome(url) &&
          url.value.protocol === "https:" &&
          !url.value.username &&
          !url.value.password
        );
      },
      { message: "Expected an HTTPS billing link without credentials" },
    ),
  ),
});
/** Browser navigation result; never contains a Stripe API secret or card data. */
export type HostedLink = typeof HostedLink.Type;

/** Authentication failures or safe billing failure categories. */
export type Error = Integration.Error | OperationFailed;

/**
 * Local backend entry to the signed-in user's billing operations. Integration supplies
 * credentials; the cloud owns customer binding and privileged Stripe calls.
 * Operations never initiate login or accept a caller-selected user/customer ID.
 * Run operations through the owning runtime, which manages request fibers.
 * Account changes invalidate in-flight results.
 * Stripe remains the subscription source of truth; there is no local ledger.
 */
export interface Interface {
  /**
   * Queries the cloud for the current account's subscription display summary.
   * Call again after returning from checkout or subscription management; browser
   * navigation alone cannot establish successful payment. Failures never become
   * `none`, and results from a superseded account must not be returned.
   * @example
   * const billing = yield* Billing.Service;
   * const subscription = yield* billing.getSubscription();
   */
  readonly getSubscription: () => Effect.Effect<Subscription, Error>;

  /**
   * Queries subscription or complimentary access without inventing a plan.
   * Provider failures remain errors; this display summary does not authorize data access.
   * @example const access = yield* billing.getAccess();
   */
  readonly getAccess: () => Effect.Effect<CloudAccess, Error>;

  /**
   * Lists existing codes without issuing any. Cloud owns all invitation state.
   * @example const invitations = yield* billing.getReferrals();
   */
  readonly getReferrals: () => Effect.Effect<Referrals, Error>;

  /**
   * Issues three lifetime codes for an eligible subscriber; retries return the same codes.
   * Complimentary access alone is insufficient. Failure never creates local state.
   * @example const invitations = yield* billing.issueReferrals();
   */
  readonly issueReferrals: () => Effect.Effect<Referrals, Error>;

  /**
   * Grants both accounts thirty days without requiring or creating a subscription.
   * Retry provider failures with the same code to resume a partially applied award.
   * @example const access = yield* billing.redeemReferral({code});
   */
  readonly redeemReferral: (
    input: RedeemReferralInput,
  ) => Effect.Effect<CloudAccess, Error>;

  /**
   * Creates a Stripe-hosted checkout link for the selected plan and period.
   * Returning a link does not complete payment or activate a subscription.
   * The cloud rejects unavailable selections and duplicate active subscriptions;
   * existing subscribers use the customer portal to change their subscription.
   *
   * ```text
   * App: choose plan + billing period
   *   -> createCheckout() -> Stripe Checkout URL
   *   -> Browser: enter payment details and confirm purchase
   *   -> App: getSubscription() to refresh the displayed status
   * ```
   *
   * @example
   * const billing = yield* Billing.Service;
   * const link = yield* billing.createCheckout({planId: selectedPlan.id, interval: 'month'});
   */
  readonly createCheckout: (
    input: CheckoutInput,
  ) => Effect.Effect<HostedLink, Error>;

  /**
   * Creates a Stripe customer-portal link for the current account to manage
   * payment methods, subscriptions, and invoices. No linked Stripe customer is
   * an explicit failure; this operation does not create a customer or subscribe.
   * This is an independent entry point; it does not call createCheckout().
   *
   * ```text
   * App: manage subscription
   *   -> createPortal() -> Stripe Customer Portal URL
   *   -> Browser: actions enabled in the portal configuration
   *        |-- Change plan / cancel renewal
   *        |-- Update payment method
   *        `-- View invoices
   *   -> App: getSubscription() to refresh the displayed status
   * ```
   *
   * @example
   * const billing = yield* Billing.Service;
   * const link = yield* billing.createPortal();
   */
  readonly createPortal: () => Effect.Effect<HostedLink, Error>;
}

/**
 * Declares the local Billing capability implemented by the billing Layer.
 * @example
 * const billing = yield* Billing.Service;
 * const subscription = yield* billing.getSubscription();
 */
export class Service extends Context.Service<Service, Interface>()(
  "@openchart/server/Billing",
) {}
