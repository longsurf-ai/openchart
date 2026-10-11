// Purpose: Expose an explicit collection request; accepted work runs independently of the request.
import { randomUUID } from "node:crypto";
import { trpc } from "@openchart/server/lib/trpc";
import { WorkspaceDatasetId } from "@openchart/server/resources/workspace-dataset/entity";
import { Schema } from "effect";

import { Collection } from "./collection";

/** Each request is a new collection; approval is a separate Resource transition. */
export const collectionRouter = trpc.router({
  collect: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(Schema.Struct({ id: WorkspaceDatasetId }), {
        parseOptions: { onExcessProperty: "error" },
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(
        Collection.Service.use((collection) =>
          collection.collect(input.id, `collect:${input.id}:${randomUUID()}`),
        ),
      ),
    ),
});
