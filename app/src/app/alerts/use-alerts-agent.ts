// Purpose: Supply the Agent profile and default model that run "Agent" alert triggers.
import { useAgentContext } from "@openchart/app/lib/agent/provider";
import type { TriggerAgent } from "@openchart/app/features/alerts/api/queries";

/**
 * The profile and model a new chat starts with, read from the shared Agent.
 * `undefined` while models load or when no default model is available; Alerts
 * then leaves its Agent channel disconnected. Throws outside AgentProvider.
 *
 * @example
 * const agent = useAlertsAgent();
 */
export function useAlertsAgent(): TriggerAgent | undefined {
  const { defaultModel } = useAgentContext().agent;
  return defaultModel ? { agent: "analyst", model: defaultModel } : undefined;
}
