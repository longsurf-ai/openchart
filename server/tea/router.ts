// Purpose: Adapt compile/snapshot/dispose RPC calls to the application-owned TeaService, and serve Tea's reference manual.
import { Effect, Schema } from "effect";

import { referenceManual } from "tea/reference";
import { trpc } from "@openchart/server/lib/trpc";
import * as Tea from "./tea";

const encodeCompileResponse = Schema.encodeSync(Tea.CompileResponse);

/** Retained compilations have explicit identity and disposal, independent of RPC lifetimes. */
export const teaRouter = trpc.router({
  compile: trpc.procedure
    .input(Schema.toStandardSchemaV1(Tea.CompileRequest))
    .mutation(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Effect.flatMap(Tea.Service, (tea) => tea.compile(input)).pipe(
          Effect.map(encodeCompileResponse),
        ),
        { signal },
      ),
    ),
  /** A Workspace script with every file its imports reach, as compilable source. */
  snapshot: trpc.procedure
    .input(Schema.toStandardSchemaV1(Tea.WorkspaceSources))
    .query(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const tea = yield* Tea.Service;
            const node = yield* Effect.acquireRelease(
              tea.compile({ ...input, includeSources: true }),
              (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
            );
            return { entry: input.path, sources: node.sources! };
          }),
        ),
        { signal },
      ),
    ),
  /** The reference manual of the Tea version this server runs, for the in-app manual. */
  reference: trpc.procedure.query(() => referenceManual),
  dispose: trpc.procedure
    .input(Schema.toStandardSchemaV1(Tea.DisposeRequest))
    .mutation(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Effect.flatMap(Tea.Service, (tea) => tea.dispose(input)),
        { signal },
      ),
    ),
});
