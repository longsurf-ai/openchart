// Purpose: Expose template discovery and installation without a separate execution path.
import { Schema } from "effect";
import { trpc } from "@openchart/server/lib/trpc";
import { chartBuiltins, indicatorCatalog } from "./catalog";
import { chartBuiltinSource, installIndicator } from "./indicators";

/** Built-in entries resolve to the same Workspace references as user scripts. */
export const indicatorsRouter = trpc.router({
  list: trpc.procedure.query(() => indicatorCatalog),
  install: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.NonEmptyString })),
    )
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(installIndicator(input.id)),
    ),
  chartBuiltin: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          id: Schema.Literals(chartBuiltins.map(({ id }) => id)),
        }),
      ),
    )
    .query(({ ctx, input }) =>
      ctx.runtime.runPromise(chartBuiltinSource(input.id)),
    ),
});
