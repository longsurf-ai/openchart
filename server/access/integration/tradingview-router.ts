// Purpose: Expose TradingView's browser login without generic OAuth or credential access.

import { Effect, Schema } from "effect";
import { trpc } from "@openchart/server/lib/trpc";
import { Integration } from "./integration";
import { TRADINGVIEW, tradingViewLoginToken } from "./tradingview";

const attemptInput = Schema.Struct({ attemptID: Integration.OAuthAttemptID });
const parseOptions = { onExcessProperty: "error" } as const;

/**
 * TradingView-only browser sign-in routes under access.tradingview. Start always
 * opens a TradingView attempt and returns public instructions and a challenge;
 * complete accepts one copied callback link and succeeds only after Integration
 * encrypts the validated session. Invalid links do not consume an attempt;
 * missing, cancelled, failed or expired attempts fail authorization. Cancel
 * releases pending work and is idempotent. Stored cookies and verifiers never
 * cross this boundary; failures use Access's public error policy. Generic
 * Integration OAuth capabilities remain internal.
 * @example const attempt = await client.access.tradingview.start.mutate();
 */
export const tradingviewRouter = trpc.router({
  start: trpc.procedure.mutation(({ ctx }) =>
    ctx.runtime.runPromise(
      Integration.Service.use((integrations) =>
        integrations.oauthAttempt.start({
          integrationID: TRADINGVIEW.integrationID,
          methodID: TRADINGVIEW.method.id,
          inputs: {},
        }),
      ),
    ),
  ),
  complete: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({ ...attemptInput.fields, link: Schema.String }),
        { parseOptions },
      ),
    )
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(
        Effect.gen(function* () {
          // The validator's error never quotes the submitted link.
          yield* Effect.try({
            try: () => tradingViewLoginToken(input.link),
            catch: (cause) => new Integration.AuthorizationError({ cause }),
          });
          const integrations = yield* Integration.Service;
          yield* integrations.oauthAttempt.complete({
            attemptID: input.attemptID,
            code: input.link,
          });
          return { status: "complete" as const };
        }),
      ),
    ),
  cancel: trpc.procedure
    .input(Schema.toStandardSchemaV1(attemptInput, { parseOptions }))
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(
        Integration.Service.use((integrations) =>
          integrations.oauthAttempt.cancel(input.attemptID),
        ),
      ),
    ),
});
