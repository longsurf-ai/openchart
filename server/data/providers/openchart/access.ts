// Purpose: Resolve OpenChart access and recovery actions from cloud admission and billing facts.
import { Effect } from "effect";
import { Billing } from "@openchart/server/access/billing";
import type { ProviderAccess } from "@openchart/server/data/provider";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import { OpenChartClient } from "./client";
import { openchartError } from "./errors";

/** Cloud admission grants access; billing only explains a denial. Failures never imply no subscription.
 * No saved credential means no account is signed in, which requires sign-in without asking billing.
 * An account reset aborts the client request, and Billing rejects results for a changed key.
 * @example const checkAccess = yield* makeAccessCheck;
 */
export const makeAccessCheck = Effect.gen(function* () {
  const client = yield* OpenChartClient;
  const billing = yield* Billing.Service;
  const denied = (cause: unknown) =>
    new DatasetFailure(new DatasetReasons.AccessDenied(), { cause });
  return Effect.fn("OpenChartProvider.checkAccess")(
    function* (): Effect.fn.Return<ProviderAccess, DatasetFailure> {
      return yield* client.getCapabilities().pipe(
        Effect.as({ status: "granted" } as const),
        Effect.catch((error) => {
          if (
            error._tag === "OpenChart.CredentialUnavailable" &&
            error.reason === "missing"
          )
            return Effect.succeed({
              status: "required",
              action: "sign-in",
            } as const);
          if (error._tag !== "OpenChartRejected" || error.status !== 403)
            return Effect.fail(openchartError(error));
          return billing.getSubscription().pipe(
            Effect.mapError(denied),
            Effect.flatMap(
              (subscription): Effect.Effect<ProviderAccess, DatasetFailure> => {
                switch (subscription.status) {
                  case "none":
                  case "canceled":
                  case "incomplete_expired":
                    return Effect.succeed({
                      status: "required",
                      action: "subscribe",
                    });
                  case "active":
                  case "trialing":
                    // The data service denied access despite an active subscription.
                    return Effect.fail(denied(error));
                  default:
                    return Effect.succeed({
                      status: "required",
                      action: "manage-subscription",
                    });
                }
              },
            ),
          );
        }),
      );
    },
  );
});
