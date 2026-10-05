// Purpose: Accept a one-way credential handoff and expose only public account state.
import { Schema } from "effect";
import { trpc } from "@openchart/server/lib/trpc";
import { Auth } from "./auth";

/**
 * Local account routes delegate the complete account lifecycle to Auth.
 * @example await client.access.auth.getState.query();
 */
export const authRouter = trpc.router({
  getState: trpc.procedure.query(({ ctx }) =>
    ctx.runtime.runPromise(Auth.Service.use((auth) => auth.getState())),
  ),
  getSavedKey: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({ userID: Schema.NonEmptyString }),
        { parseOptions: { onExcessProperty: "error" } },
      ),
    )
    .query(({ ctx, input }) =>
      ctx.runtime.runPromise(
        Auth.Service.use((auth) => auth.getSavedKey(input.userID)),
      ),
    ),
  restoreSignIn: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(Auth.RestoreSignInInput, {
        parseOptions: { onExcessProperty: "error" },
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(
        Auth.Service.use((auth) => auth.restoreSignIn(input)),
      ),
    ),
  completeSignIn: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(Auth.SignInInput, {
        parseOptions: { onExcessProperty: "error" },
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(
        Auth.Service.use((auth) => auth.completeSignIn(input)),
      ),
    ),
  logout: trpc.procedure.mutation(({ ctx }) =>
    ctx.runtime.runPromise(Auth.Service.use((auth) => auth.logout())),
  ),
});
