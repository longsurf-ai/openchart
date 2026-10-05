// Purpose: Check Tea source and optional bindings through the application's compiler.
import { Effect, Schema } from "effect";

import * as Tool from "@openchart/server/agent/tool/tool";
import * as Tea from "@openchart/server/tea/tea";
import {
  TeaSourceFields,
  hasTeaSource,
  resolveTeaSource,
  compilationSource,
  describeTea,
  teaConfigDescription,
} from "./tea-shared";

// Keep an object at the provider boundary; the refinement enforces exactly one source.
export const Parameters = Schema.Struct({
  ...TeaSourceFields,
  // NodeConfig's `requests` reach it through suspend; config does the same, so
  // the tool's JSON Schema holds one NodeConfig definition, not two copies.
  config: Schema.optionalKey(Schema.suspend(() => Tea.NodeConfig)),
})
  .pipe(
    Schema.refine(hasTeaSource, {
      message: "Supply exactly one of path or source",
    }),
  )
  .annotate({ parseOptions: { onExcessProperty: "error" } });

/**
 * Compiles a file or self-contained source and optionally validates a
 * NodeConfig against it. The config may name no other nodes, so a NodeRef
 * input fails validation. Relative paths use the executing Assistant's cwd.
 * Scope releases the compiled node on success, failure and interruption;
 * neither compilation nor validation acquires Feed. Tea diagnostics become
 * model feedback; permission and infrastructure failures propagate.
 * @example const result = yield* tool.execute({source: 'plot("price", close)'}, context);
 */
export const TeaCheckTool = Tool.define(
  "tea_check",
  Effect.succeed({
    description: `Compile Tea before saving an Alert or attaching an indicator. Supply exactly one of path (absolute, or relative to this invocation's workspace cwd) and source (self-contained text; relative imports are unavailable). A successful check returns declaration (the indicator() header, or null), definition and alertOutputs. definition is the compiled script as JSON: parameters, inputs (the columns it reads with default parameters), outputs, and one child definition per request, with the target (ticker id and timeframe) its line asks for, or null when that depends on the script's own listing; inputs and outputs are Arrow JSON schemas, the same form config uses. Use it to build config. With config, bindings are also validated. ${teaConfigDescription} Results distinguish config: 'valid' from 'not_checked'; rejected results contain Tea diagnostics. Checks release all temporary compilations and do not fetch bars, save rules or start alerts; a left-out request child only looks up its listing. Compilation/binding success does not prove runtime behavior or market-data availability.`,
    parameters: Parameters,
    execute: Effect.fn("TeaCheck.execute")(function* (
      input: typeof Parameters.Type,
      context: Tool.Context,
    ) {
      const request = yield* resolveTeaSource(input, context);
      yield* context.ask({
        permission: "tea_check",
        patterns: [request.path ?? "inline"],
        always: ["*"],
        metadata: {},
      });
      const tea = yield* Tea.Service;
      const value = yield* Effect.scoped(
        Effect.gen(function* () {
          const node = yield* Effect.acquireRelease(
            tea.compile(yield* compilationSource(request)),
            (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
          );
          if (input.config !== undefined)
            yield* tea.validate({ id: node.id, ...input.config, nodes: {} });
          return {
            status: "ok",
            config: input.config === undefined ? "not_checked" : "valid",
            declaration: node.declaration,
            ...describeTea(node.definition),
          };
        }),
      ).pipe(
        Effect.catchTag("TeaError", (error) =>
          Effect.succeed({
            status: "rejected",
            code: error.code,
            message: error.message,
          }),
        ),
      );
      return {
        title: "Check Tea",
        metadata: {},
        output: { type: "json" as const, value },
      };
    }),
  }),
);
