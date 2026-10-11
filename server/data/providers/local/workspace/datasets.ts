// Purpose: Declare one runtime timeseries Dataset per Workspace Dataset and read it from the current CSV file.
import { Effect, Schema } from "effect";
import {
  DatasetFailure,
  DatasetReasons,
  defineRuntimeDataset,
  k,
  Layout,
  type DatasetDefinition,
  type RuntimeDefinition,
} from "@openchart/server/data/dataset";
import type { WorkspaceDatasetEntity } from "@openchart/server/resources/workspace-dataset/entity";
import type { WorkspaceDatasetId } from "@openchart/server/resources/workspace-dataset/schema";
import type { Workspaces } from "@openchart/server/workspace/workspace";
import type { DataFrame } from "@openchart/timeseries";
import { decodeRows } from "./csv";

const columnSchemas = {
  number: Schema.Number,
  string: Schema.String,
  boolean: Schema.Boolean,
} as const;

/** Runtime declarations this Provider created, by exact identity. */
const owned = new WeakMap<DatasetDefinition, WorkspaceDatasetId>();

/** The Workspace Dataset a declaration serves; other declarations return undefined.
 * @example workspaceDatasetIdOf(dataset.definition);
 */
export const workspaceDatasetIdOf = (definition: DatasetDefinition) =>
  owned.get(definition);

/** The fields whose change requires a new declaration; names and collection do not. */
export const declarationKey = ({
  source,
  time,
  columns,
}: WorkspaceDatasetEntity) => JSON.stringify({ source, time, columns });

/**
 * Declares and registers the timeseries Dataset for one Resource, named
 * `workspace.<id>`, with a `time` range key and select only.
 * The caller unregisters it after retiring its last instance.
 * @throws If a declaration with the same name is still registered.
 * @example const definition = declareWorkspaceDataset(entity);
 */
export function declareWorkspaceDataset(
  dataset: WorkspaceDatasetEntity,
): RuntimeDefinition {
  const definition = defineRuntimeDataset({
    name: `workspace.${dataset.id}`,
    keys: Schema.Struct({ time: k.range(Schema.Number) }),
    schema: Schema.Struct({
      time: Schema.Number,
      ...Object.fromEntries(
        dataset.columns.map((column) => [
          column.name,
          columnSchemas[column.type],
        ]),
      ),
    }),
    layout: Layout.Timeseries,
    access: { select: true },
  });
  owned.set(definition, dataset.id);
  return definition;
}

/** The select query the declaration derives: a time range and an optional latest count. */
export interface SelectQuery {
  readonly time: { readonly from?: number; readonly to?: number };
  readonly count?: number;
}

const failure = (reason: DatasetFailure["reason"]) => (cause: unknown) =>
  new DatasetFailure(reason, { cause });

/**
 * Reads the Resource's CSV file now, so every select sees the file's current
 * rows. `from` is inclusive and `to` exclusive; `count` keeps the latest rows.
 * A missing Workspace or file is `Dataset.NotFound`; text that does not match
 * the declaration is `Dataset.InvalidResult` with the row at fault as its cause.
 * @example yield* selectWorkspaceDataset(workspaces, entity, definition, {time: {}});
 */
export const selectWorkspaceDataset = Effect.fn("WorkspaceDataset.select")(
  function* (
    workspaces: Workspaces["Service"],
    dataset: WorkspaceDatasetEntity,
    definition: RuntimeDefinition,
    query: SelectQuery,
  ): Effect.fn.Return<DataFrame, DatasetFailure> {
    const file = yield* workspaces.open(dataset.source.workspaceId).pipe(
      Effect.flatMap((workspace) => workspace.read(dataset.source.path)),
      Effect.mapError((error) =>
        error._tag === "EntryMissing" ||
        error._tag === "WorkspaceUnknown" ||
        error._tag === "WorkspaceMissing"
          ? failure(new DatasetReasons.NotFound())(error)
          : failure(new DatasetReasons.Unavailable())(error),
      ),
    );
    const { from, to } = query.time;
    // The declaration's own frame checks column types and strictly ascending time.
    return yield* Effect.try({
      try: () => {
        const rows = decodeRows(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.from(file.base64, "base64"),
          ),
          dataset,
        ).filter(
          (row) =>
            (from === undefined || row.time >= from) &&
            (to === undefined || row.time < to),
        );
        return definition.frame!.create({
          labels: {},
          rows: query.count === undefined ? rows : rows.slice(-query.count),
        });
      },
      catch: failure(new DatasetReasons.InvalidResult()),
    });
  },
);
