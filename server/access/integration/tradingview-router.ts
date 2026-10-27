// Purpose: Expose TradingView's browser login without generic OAuth or credential access.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Effect, Schema } from "effect";
import { trpc } from "@openchart/server/lib/trpc";
import { Integration } from "./integration";
import { TRADINGVIEW, tradingViewLoginToken } from "./tradingview";

const attemptInput = Schema.Struct({ attemptID: Integration.OAuthAttemptID });
const parseOptions = { onExcessProperty: "error" } as const;
// Process-local; attempts never outlive the server that started them.
const proofKey = randomBytes(32);
const attemptProof = (attemptID: string) =>
  createHmac("sha256", proofKey).update(attemptID).digest();

/** Whether `proof` is the one start returned for `attemptID`, in constant time. */
function provesAttempt(attemptID: string, proof: string): boolean {
  const expected = attemptProof(attemptID);
  const supplied = Buffer.from(proof, "base64url");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

/**
 * TradingView-only browser sign-in routes under access.tradingview. Start always
 * opens a TradingView attempt and returns public instructions, a challenge and
 * a private completion proof; complete requires that proof, so only the client
 * that started an attempt can bind a login link to it, and succeeds only after
 * Integration encrypts the validated session. Invalid proofs or links do not
 * consume an attempt;
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
      ).pipe(
        Effect.map((attempt) => ({
          ...attempt,
          proof: attemptProof(attempt.attemptID).toString("base64url"),
        })),
      ),
    ),
  ),
  complete: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          ...attemptInput.fields,
          proof: Schema.String,
          link: Schema.String,
        }),
        { parseOptions },
      ),
    )
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(
        Effect.gen(function* () {
          if (!provesAttempt(input.attemptID, input.proof))
            return yield* new Integration.AuthorizationError({
              cause: new Error("TradingView sign-in was started elsewhere."),
            });
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
