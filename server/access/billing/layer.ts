// Purpose: Call cloud billing with current Integration credentials and discard superseded account results.

import { Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { Integration } from "@openchart/server/access/integration";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
import { Billing } from "./billing";

/** Host-owned billing endpoint; HTTPS in deployments, HTTP loopback for tests. */
export interface Configuration {
  readonly baseUrl: string;
  readonly requestTimeoutMs?: number;
}

const ConfigurationSchema = Schema.Struct({
  baseUrl: Schema.URLFromString.check(
    Schema.makeFilter(
      (url) =>
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))),
    ),
  ),
  requestTimeoutMs: Schema.optional(
    Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  ),
});
const reasons = {
  referral_invalid: "referral-invalid",
  referral_used: "referral-used",
  referral_already_redeemed: "referral-already-redeemed",
  referral_self: "referral-self",
  subscription_required: "subscription-required",
  unauthorized: "unauthorized",
  invalid_request: "invalid-request",
  unsupported_plan: "invalid-plan",
  customer_not_found: "customer-not-found",
  subscription_exists: "already-subscribed",
  checkout_in_progress: "checkout-in-progress",
  checkout_changed: "checkout-changed",
  billing_state_invalid: "billing-state-invalid",
  upstream_unavailable: "provider",
  configuration_invalid: "configuration-invalid",
  not_found: "provider",
  internal_error: "provider",
} as const satisfies Record<string, Billing.OperationFailed["reason"]>;
const CloudError = Schema.Struct({
  error: Schema.Struct({
    code: Schema.Literals(Object.keys(reasons) as Array<keyof typeof reasons>),
  }),
});
const failed = (reason: Billing.OperationFailed["reason"]) =>
  new Billing.OperationFailed({ reason });

/**
 * Resolves a key for each call, enforces a deadline, and rechecks credentials
 * before returning results. No subscription or key is cached.
 * Unconfigured hosts fail on use. The owning runtime manages request fibers;
 * each request scope releases its HTTP resources on completion or interruption.
 * @example const billing = layer({baseUrl: 'https://billing.example.com'});
 */
export function layer(options?: Configuration) {
  return Layer.effect(
    Billing.Service,
    Effect.gen(function* () {
      if (!options)
        return Billing.Service.of({
          getSubscription: () => Effect.fail(failed("not-configured")),
          getAccess: () => Effect.fail(failed("not-configured")),
          getReferrals: () => Effect.fail(failed("not-configured")),
          issueReferrals: () => Effect.fail(failed("not-configured")),
          redeemReferral: () => Effect.fail(failed("not-configured")),
          createCheckout: () => Effect.fail(failed("not-configured")),
          createPortal: () => Effect.fail(failed("not-configured")),
        });
      const config = yield* Schema.decodeUnknownEffect(ConfigurationSchema)(
        options,
      ).pipe(Effect.mapError(() => failed("configuration-invalid")));
      const integration = yield* Integration.Service;
      const client = HttpClient.withScope(yield* HttpClient.HttpClient);
      const readKey = Effect.fn("Billing.readKey")(function* () {
        const value = yield* integration.connection.resolveCredential(
          OPENCHART_CLOUD.integrationID,
        );
        if (!value) return yield* failed("missing-credential");
        if (value.type !== "key") return yield* failed("invalid-credential");
        return value.key;
      });

      const request = Effect.fn("Billing.request")(
        function* <A>(
          method: "GET" | "POST",
          path: string,
          schema: Schema.Codec<A>,
          input?: Billing.CheckoutInput | Billing.RedeemReferralInput,
        ) {
          const key = yield* readKey();
          let outbound = HttpClientRequest.make(method)(
            new URL(
              `billing/${path}`,
              `${config.baseUrl.href.replace(/\/$/, "")}/`,
            ).href,
          ).pipe(HttpClientRequest.setHeader("Authorization", `Bearer ${key}`));
          if (input)
            outbound = outbound.pipe(HttpClientRequest.bodyJsonUnsafe(input));
          const response = yield* client
            .execute(outbound)
            .pipe(Effect.mapError(() => failed("network")));
          if (response.status === 401) return yield* failed("unauthorized");
          if (response.status === 429) return yield* failed("rate-limited");
          if (response.status < 200 || response.status >= 300) {
            const error = yield* HttpClientResponse.schemaBodyJson(CloudError)(
              response,
            ).pipe(Effect.mapError(() => failed("provider")));
            return yield* failed(reasons[error.error.code]);
          }
          const result = yield* HttpClientResponse.schemaBodyJson(schema, {
            onExcessProperty: "error",
          })(response).pipe(Effect.mapError(() => failed("invalid-response")));
          // An account change must not expose a previous credential's result.
          const current = yield* readKey();
          if (current !== key) return yield* failed("credential-changed");
          return result;
        },
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: config.requestTimeoutMs ?? 30_000,
          orElse: () => Effect.fail(failed("timeout")),
        }),
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: "error",
        }),
      );

      return Billing.Service.of({
        getSubscription: () =>
          request("GET", "subscription", Billing.Subscription),
        getAccess: () => request("GET", "access", Billing.CloudAccess),
        getReferrals: () => request("GET", "referrals", Billing.Referrals),
        issueReferrals: () => request("POST", "referrals", Billing.Referrals),
        redeemReferral: (input) =>
          request("POST", "referrals/redeem", Billing.CloudAccess, input),
        createCheckout: (input) =>
          request("POST", "checkout", Billing.HostedLink, input),
        createPortal: () => request("POST", "portal", Billing.HostedLink),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
