// Purpose: Validates preserved migration fixtures from before saved prompt composer constraints.

import { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import { AgentPromptTarget } from "@openchart/server/agent/contracts/agent-prompt-target";

/** Historical targets preserve complete execution inputs, including non-composer Parts.
 * Current authoring constraints are covered by AgentPromptTarget and Resource write tests.
 * @example Schema.decodeUnknownSync(HistoricalPromptTarget)(migrated.target);
 */
export const HistoricalPromptTarget = AgentPromptTarget.mapFields((fields) => ({
  ...fields,
  prompt: AgentPromptInput,
}));
