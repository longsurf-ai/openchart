// Purpose: Explicit runtime registry for prompt segment text assets

import { readFileSync } from "node:fs";
import type { PromptSegmentRegistry } from "@openchart/server/agent/profiles/prompt/compiler";

/** Complete built-in prompt text assets keyed by their manifest paths. */
export const promptSegmentRegistry: PromptSegmentRegistry = {
  "../segments/resources.txt": readFileSync(
    new URL("./resources.txt", import.meta.url),
    "utf8",
  ),
  "../segments/tea.txt": readFileSync(
    new URL("./tea.txt", import.meta.url),
    "utf8",
  ),
  "../segments/posts.txt": readFileSync(
    new URL("./posts.txt", import.meta.url),
    "utf8",
  ),
  "../segments/alerts.txt": readFileSync(
    new URL("./alerts.txt", import.meta.url),
    "utf8",
  ),
  "../segments/identity.txt": readFileSync(
    new URL("./identity.txt", import.meta.url),
    "utf8",
  ),
  "../segments/communication.txt": readFileSync(
    new URL("./communication.txt", import.meta.url),
    "utf8",
  ),
  "../segments/title.txt": readFileSync(
    new URL("./title.txt", import.meta.url),
    "utf8",
  ),
  "../segments/compaction.txt": readFileSync(
    new URL("./compaction.txt", import.meta.url),
    "utf8",
  ),
};
