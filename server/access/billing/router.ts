// Purpose: Expose current-account billing through the local access tRPC namespace.
import { Schema } from "effect";
import { trpc } from "@openchart/server/lib/trpc";
import { Billing } from "./billing";

/** Local billing routes. @example await client.access.billing.getSubscription.query(); */
export const billingRouter = trpc.router({
  getAccess: trpc.procedure.query(({ ctx, signal }) =>
    ctx.runtime.runPromise(
      Billing.Service.use((billing) => billing.getAccess()),
      { signal },
    ),
  ),
  getReferrals: trpc.procedure.query(({ ctx, signal }) =>
    ctx.runtime.runPromise(
      Billing.Service.use((billing) => billing.getReferrals()),
      { signal },
    ),
  ),
  issueReferrals: trpc.procedure.mutation(({ ctx, signal }) =>
    ctx.runtime.runPromise(
      Billing.Service.use((billing) => billing.issueReferrals()),
      { signal },
    ),
  ),
  redeemReferral: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(Billing.RedeemReferralInput, {
        parseOptions: { onExcessProperty: "error" },
      }),
    )
    .mutation(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Billing.Service.use((billing) => billing.redeemReferral(input)),
        { signal },
      ),
    ),
  getSubscription: trpc.procedure.query(({ ctx, signal }) =>
    ctx.runtime.runPromise(
      Billing.Service.use((billing) => billing.getSubscription()),
      { signal },
    ),
  ),
  createCheckout: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(Billing.CheckoutInput, {
        parseOptions: { onExcessProperty: "error" },
      }),
    )
    .mutation(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Billing.Service.use((billing) => billing.createCheckout(input)),
        { signal },
      ),
    ),
  createPortal: trpc.procedure.mutation(({ ctx, signal }) =>
    ctx.runtime.runPromise(
      Billing.Service.use((billing) => billing.createPortal()),
      { signal },
    ),
  ),
});
