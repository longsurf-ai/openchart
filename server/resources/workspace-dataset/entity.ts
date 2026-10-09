// Purpose: Derive the Workspace Dataset entity and require a declaration that maps onto one timeseries DataFrame.
import { serverManaged } from "@openchart/server/lib/resource/annotation";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { AgentPromptTarget } from "@openchart/server/agent/contracts/agent-prompt-target";
import { ReadInput, RelPath } from "@openchart/server/workspace/contract";
import { Schema } from "effect";

import { WorkspaceDatasetId } from "./schema";

export { WorkspaceDatasetId } from "./schema";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

/** Scalar types a declared column may hold; they map to DataFrame Float64, Utf8 and Bool. */
export const DATASET_COLUMN_TYPES = ["number", "string", "boolean"] as const;

/** A header name in the data file, exactly as written there. */
export const DatasetColumnName = Schema.String.check(Schema.isMinLength(1));

/** One observation column read from the data file. */
export const DatasetColumn = Schema.Struct({
  name: DatasetColumnName,
  type: Schema.Literals(DATASET_COLUMN_TYPES),
}).annotate(strict);
export type DatasetColumn = typeof DatasetColumn.Type;

/** A CSV data file inside a registered Workspace. */
export const DatasetDataPath = RelPath.check(
  Schema.makeFilter((path) => path.toLowerCase().endsWith(".csv"), {
    message: "Expected a .csv data file",
  }),
);

/**
 * Runs a Workspace Python script with `uv run --script`; dependencies come
 * from its inline PEP 723 metadata. The script writes the file named by
 * `OPENCHART_OUTPUT`, which replaces the data file only after a zero exit.
 */
export const ScriptCollection = Schema.Struct({
  kind: Schema.Literal("script"),
  path: RelPath.check(
    Schema.makeFilter((path) => path.toLowerCase().endsWith(".py"), {
      message: "Expected a .py script",
    }),
  ),
  args: Schema.optionalKey(Schema.Array(Schema.String)),
}).annotate(strict);
export type ScriptCollection = typeof ScriptCollection.Type;

/**
 * How new data reaches the file: a deterministic script, or an Agent prompt
 * (a `.workflow.ts` is a prompt holding one WorkflowPart). Null means the file
 * is maintained directly. Collection never runs from Resource CRUD.
 */
export const DatasetCollection = Schema.Union([
  AgentPromptTarget,
  ScriptCollection,
]) as unknown as Schema.Codec<
  AgentPromptCollection | ScriptCollection,
  unknown
>;
export type DatasetCollection = typeof DatasetCollection.Type;

/**
 * An Agent prompt collection as the Resource's TypeScript surface outlines it.
 * The schema still validates a complete AgentPromptTarget, and Collection
 * decodes it again before admission. A second fully typed Agent prompt beside
 * agent_schedule's, or a recursive Json type, exceeds TypeScript's
 * instantiation limit (TS2589) where the app first infers the tRPC router
 * during incremental checks.
 */
export type AgentPromptCollection = {
  readonly kind: "agent_prompt";
  readonly prompt: {
    readonly agent: string;
    readonly model: { readonly providerID: string; readonly modelID: string };
    readonly parts: ReadonlyArray<{
      readonly type: string;
      readonly text?: string;
    }>;
  };
  readonly binding?: { readonly key: string };
};

/**
 * One Workspace Dataset with its own revision. `source` names the CSV file,
 * `time.column` its timestamp header (epoch milliseconds or ISO 8601), and
 * `columns` the observation headers to read. `collection` describes how the
 * file is refreshed; `approvedScriptHash` records the script a person approved.
 */
export const WorkspaceDatasetEntity = Schema.Struct({
  ...envelopeFields(WorkspaceDatasetId),
  name: Schema.Trim.check(Schema.isLengthBetween(1, 160)),
  description: Schema.NullOr(Schema.String),
  source: Schema.Struct({
    workspaceId: ReadInput.fields.workspaceId,
    path: DatasetDataPath,
  }),
  time: Schema.Struct({ column: DatasetColumnName }),
  // A field check, not withInvariants: invariant paths would type the whole
  // AgentPromptInput tree inside `collection`, exceeding TypeScript's depth limit.
  columns: Schema.NonEmptyArray(DatasetColumn).check(
    Schema.makeFilter(
      (columns) =>
        new Set(["time", ...columns.map((column) => column.name)]).size ===
        columns.length + 1,
      {
        message:
          'Column names must be distinct, and "time" is reserved for the timestamp',
      },
    ),
  ),
  collection: Schema.NullOr(DatasetCollection),
  approvedScriptHash: serverManaged(Schema.NullOr(Schema.String)),
});

/** Complete Workspace Dataset returned by Resource reads. */
export type WorkspaceDatasetEntity = typeof WorkspaceDatasetEntity.Type;
