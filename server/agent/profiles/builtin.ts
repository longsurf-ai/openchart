// Purpose: Registers OpenChart's three core Agent profiles and their local prompt assets.

import { analystPromptContext } from "./prompt/analyst/context";
import { analystPromptManifest } from "./prompt/analyst/manifest";
import { compactionPromptManifest } from "./prompt/compaction/manifest";
import { compilePrompt } from "./prompt/compiler";
import { promptSegmentRegistry } from "./prompt/segments/registry";
import { titlePromptManifest } from "./prompt/title/manifest";
import type { AgentProfile } from "./profile";

const titlePrompt = compilePrompt({
  manifest: titlePromptManifest,
  registry: promptSegmentRegistry,
});
const compactionPrompt = compilePrompt({
  manifest: compactionPromptManifest,
  registry: promptSegmentRegistry,
});

/**
 * Contributes OpenChart's built-in definitions to the registry draft.
 * Analyst describes the implemented V2 tools and shared Resource catalog.
 * Analyst allows the listed tools except Task, which requires approval.
 * Other profiles deny tools.
 * Per-request tool execution bindings remain caller-owned.
 * @example
 * yield* profiles.transform(registerBuiltins);
 */
export function registerBuiltins(
  draft: AgentProfile.Draft,
  documentationDirectory?: string,
): void {
  draft.update("analyst", (info) => {
    info.description = "Financial research agent.";
    info.mode = "primary";
    info.prompt = compilePrompt({
      manifest: analystPromptManifest,
      registry: promptSegmentRegistry,
      context: { ...analystPromptContext, documentationDirectory },
    });
    info.permission.push(
      { action: "echo", resource: "*", decision: "allow" },
      { action: "workflow", resource: "*", decision: "allow" },
      { action: "task", resource: "*", decision: "allow" },
      { action: "resource_read", resource: "*", decision: "allow" },
      { action: "resource_search", resource: "*", decision: "allow" },
      { action: "resource_mutate", resource: "*", decision: "allow" },
      { action: "read_transcript", resource: "*", decision: "allow" },
      { action: "search_transcript", resource: "*", decision: "allow" },
      { action: "create_schedule", resource: "*", decision: "allow" },
      { action: "save_alert_rule", resource: "alert_rule", decision: "allow" },
      { action: "symbology_search", resource: "*", decision: "allow" },
      { action: "publish_post", resource: "post", decision: "allow" },
      { action: "market_data", resource: "*", decision: "allow" },
      { action: "dataset_select", resource: "*", decision: "allow" },
      { action: "tea_check", resource: "*", decision: "allow" },
      { action: "tea_run", resource: "*", decision: "allow" },
    );
  });
  draft.update("title", (info) => {
    info.mode = "primary";
    info.hidden = true;
    info.prompt = titlePrompt;
  });
  draft.update("compaction", (info) => {
    info.mode = "primary";
    info.hidden = true;
    info.prompt = compactionPrompt;
  });
}
