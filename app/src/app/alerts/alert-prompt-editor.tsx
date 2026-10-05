// Purpose: Compose Alerts with the same complete prompt editor used by Schedule.
import type { AlertPromptEditorRenderer } from "@openchart/app/features/alerts/components/alert-rule-dialog";
import { AgentPromptEditor } from "@openchart/app/features/agent/components/prompt-editor/prompt-editor";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Bind Agent editing without creating a Session or running the saved prompt. @example const renderPromptEditor = alertPromptEditor(transport); */
export function alertPromptEditor(
  transport: AppTransport,
): AlertPromptEditorRenderer {
  return function AlertComposer(props) {
    return <AgentPromptEditor {...props} transport={transport} />;
  };
}
