// Purpose: Defines Billing API failures without exposing payment data or secrets.

import { Schema } from "effect";

/**
 * Expected billing failure. Reasons carry no provider response bodies, payment
 * links, card data, or service credentials. Credential failures retain their own tags.
 * @example
 * const error = new OperationFailed({reason: 'timeout'});
 */
export class OperationFailed extends Schema.TaggedError<OperationFailed>()(
  "Billing.OperationFailed",
  {
    reason: Schema.Literals([
      "referral-invalid",
      "referral-used",
      "referral-already-redeemed",
      "referral-self",
      "subscription-required",
      "not-configured",
      "missing-credential",
      "credential-changed",
      "invalid-credential",
      "unauthorized",
      "network",
      "timeout",
      "provider",
      "invalid-response",
      "invalid-plan",
      "already-subscribed",
      "customer-not-found",
      "checkout-in-progress",
      "checkout-changed",
      "billing-state-invalid",
      "configuration-invalid",
      "rate-limited",
      "invalid-request",
    ]),
  },
) {}
