// Purpose: Save a Workspace widget file as a live custom widget through the Custom Widget's own transition.
import { Effect, Schema, Struct } from "effect";
import { Tool } from "@openchart/server/agent/tool/tool";
import { Workflow } from "@openchart/server/agent/workflow";
import { Transactor } from "@openchart/server/lib/resource";
import { customWidgetResource } from "@openchart/server/resources/custom-widget";
import { CustomWidgetPath } from "@openchart/server/resources/custom-widget/entity";
import { workspaceResource } from "@openchart/server/resources/workspace";
import { WorkspaceId } from "@openchart/server/resources/workspace/entity";
import { ask, result } from "./resource-shared";

const Parameters = Schema.Struct({
  path: CustomWidgetPath,
}).annotate({ parseOptions: { onExcessProperty: "error" } });

/**
 * Checks and saves one `.widget.tsx` file from the prompt's Workspace (the
 * default Workspace when none is selected) after permission. Failures return
 * the check's diagnostics and change nothing; cancellation and permission
 * outcomes propagate. Placing the widget on a Dashboard stays a separate write.
 * @example const result = yield* tool.execute({ path: "widgets/rates.widget.tsx" }, context);
 */
export const SaveWidgetTool = Tool.define(
  "save_widget",
  Effect.succeed({
    description:
      "Save a dashboard widget you wrote as a .widget.tsx file in the current Workspace, given its Workspace-relative path. Only saved code runs: a failed type check returns diagnostics and saves nothing, so fix and save again. Saving does not place the widget; add the returned placementKind to a dashboard.",
    parameters: Parameters,
    execute: (input: typeof Parameters.Type, context: Tool.Context) =>
      result(
        "Save widget",
        Effect.gen(function* () {
          yield* ask(context, "save_widget", ["custom_widget"], input);
          const { parentPrompt } = yield* Workflow.Service;
          const workspaceId = parentPrompt.workspaceId
            ? WorkspaceId.make(parentPrompt.workspaceId)
            : yield* Transactor.run(workspaceResource.transitions.getDefault());
          // The Agent wrote the source; echoing it back only spends context.
          const widget = Struct.omit(
            yield* Transactor.run(
              customWidgetResource.transitions.save({ ...input, workspaceId }),
            ),
            ["snapshot"],
          );
          // The app places custom widgets under this prefix (app/src/app/widgets/custom).
          return {
            resource: customWidgetResource.name,
            entity: widget,
            placementKind: `custom:${widget.kind}`,
          };
        }),
      ),
  }),
);
