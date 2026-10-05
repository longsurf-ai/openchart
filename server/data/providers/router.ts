// Purpose: Expose provider-owned access checks and explicit activation refreshes.
import { Effect, Schema } from "effect";
import { ProviderId } from "@openchart/market";
import { datasetFailure } from "@openchart/server/feed/errors";
import { trpc } from "@openchart/server/lib/trpc";
import { AccessCheckedProviderId, accessCheckedDataProviders } from "./index";

/** Access checks do not change the user's enabled preference. */
export const providersRouter = trpc.router({
  checkAccess: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({ providerId: AccessCheckedProviderId }),
      ),
    )
    .query(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Effect.flatMap(accessCheckedDataProviders, (providers) =>
          providers[input.providerId].checkAccess(),
        ).pipe(
          Effect.mapError(datasetFailure(ProviderId.make(input.providerId))),
        ),
        { signal },
      ),
    ),
  refresh: trpc.procedure.mutation(({ ctx, signal }) =>
    ctx.runtime.runPromise(
      Effect.flatMap(accessCheckedDataProviders, (providers) =>
        Effect.forEach(
          Object.values(providers),
          (provider) => provider.refresh(),
          { discard: true },
        ),
      ),
      { signal },
    ),
  ),
});
