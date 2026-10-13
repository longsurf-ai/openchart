// Purpose: Reads the current Watchlist and researches its selected rows through ordinary child Agents.
import {
  agent,
  AgentPromptInput,
  defineWorkflow,
  Effect,
  parallel,
  resource,
  Schema,
} from "@openchart/workflow";

// The plugin resolves each cell's listing context. This program only fans out row IDs.
const Item = Schema.Struct({
  id: Schema.String,
  listing: Schema.Struct({ symbol: Schema.String }),
});
type Section = {
  readonly items: readonly (typeof Item.Type)[];
  readonly sections: readonly Section[];
};
const Section: Schema.Codec<Section> = Schema.Struct({
  items: Schema.Array(Item),
  sections: Schema.Array(Schema.suspend(() => Section)),
});
const Watchlist = Schema.Struct({
  columns: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      metric: Schema.Struct({
        kind: Schema.String,
      }),
    }),
  ),
  sections: Schema.Array(Section),
});
const watchlistSemanticColumnArgs = Schema.Struct({
  watchlistId: Schema.NonEmptyString,
  columnId: Schema.NonEmptyString,
  prompt: AgentPromptInput,
  itemIds: Schema.optionalKey(
    Schema.Array(Schema.NonEmptyString).annotate({
      description:
        "Watchlist row IDs (wit_...) to research. Omit to research all current rows across all sections, including nested sections, when the workflow runs. Pass one ID to refresh a single cell; an empty array researches no rows.",
    }),
  ),
});

function collectRows(sections: readonly Section[]): (typeof Item.Type)[] {
  return sections.flatMap((section) => [
    ...section.items,
    ...collectRows(section.sections),
  ]);
}

const selectRows = Effect.fnUntraced(function* (
  sections: readonly Section[],
  itemIds: readonly string[] | undefined,
) {
  const all = collectRows(sections);
  if (itemIds && new Set(itemIds).size !== itemIds.length)
    return yield* Effect.fail(new Error("Research rows must not repeat."));
  if (!itemIds) return all;

  const rows: (typeof Item.Type)[] = [];
  for (const id of itemIds) {
    const row = all.find((row) => row.id === id);
    if (!row)
      return yield* Effect.fail(
        new Error("A selected research row no longer exists."),
      );
    rows.push(row);
  }
  return rows;
});

function cellPrompt(
  args: typeof watchlistSemanticColumnArgs.Type,
  itemId: string,
): AgentPromptInput {
  return {
    ...args.prompt,
    parts: [
      ...args.prompt.parts,
      {
        type: "plugin_input",
        input: {
          type: "watchlist_semantic_cell",
          watchlistId: args.watchlistId,
          columnId: args.columnId,
          itemId,
        },
      },
    ],
  };
}

/** Every execution enumerates current membership; each child validates its cell before researching it. */
export default defineWorkflow({
  description:
    "Research one AI column of an existing Watchlist. Args: watchlistId, columnId, prompt, optional itemIds. Omit itemIds for all current rows. Each child binds its cell; its sourced text answer is returned per row. The host bounds parallelism and owns cancellation.",
  args: watchlistSemanticColumnArgs,
  run: (args) =>
    Effect.gen(function* () {
      const watchlist = yield* resource.get(
        "watchlist",
        args.watchlistId,
        Watchlist,
      );
      if (
        !watchlist.columns.some(
          (column) =>
            column.id === args.columnId && column.metric.kind === "semantic",
        )
      )
        return yield* Effect.fail(
          new Error("The research column does not exist."),
        );
      const rows = yield* selectRows(watchlist.sections, args.itemIds);
      const outcomes = yield* parallel(
        rows.map((row) =>
          agent(cellPrompt(args, row.id), {
            label: row.listing.symbol,
          }),
        ),
      );
      return {
        cells: rows.map((row, index) => ({
          itemId: row.id,
          outcome: outcomes[index]!,
        })),
      };
    }),
});
