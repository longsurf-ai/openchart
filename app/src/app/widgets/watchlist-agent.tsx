// Purpose: Supply Agent presentation to Watchlist research without feature-to-feature imports.
import type { PropsWithChildren } from "react";

import { useCopilotControls } from "@openchart/app/app/agent/copilot-controls";
import { AgentPromptEditor } from "@openchart/app/features/agent/components/prompt-editor/prompt-editor";
import {
  WatchlistOpenSession,
  WatchlistPromptEditor,
  type WatchlistPromptEditorProps,
} from "@openchart/app/features/watchlist/components/context";
import { useWidget } from "@openchart/app/hooks/use-widget";
import type { PromptParts } from "@openchart/app/lib/prompt-converter/converter";

function ResearchPromptEditor({
  prompt,
  ...props
}: WatchlistPromptEditorProps) {
  const { transport } = useWidget();
  return (
    <AgentPromptEditor
      {...props}
      transport={transport}
      prompt={
        prompt
          ? { ...prompt, parts: prompt.parts as unknown as PromptParts }
          : undefined
      }
    />
  );
}

/**
 * Supplies the shared saved-prompt Composer and existing Agent navigation to Watchlist slots.
 * Slots render inside widget and Agent contexts. Agent components own observation
 * cleanup and error handling; this adapter neither starts nor cancels research.
 *
 * @example <WatchlistAgent><WatchlistView /></WatchlistAgent>
 */
export function WatchlistAgent({ children }: PropsWithChildren) {
  const copilot = useCopilotControls();
  return (
    <WatchlistOpenSession.Provider value={copilot?.selectSession ?? null}>
      <WatchlistPromptEditor.Provider value={ResearchPromptEditor}>
        {children}
      </WatchlistPromptEditor.Provider>
    </WatchlistOpenSession.Provider>
  );
}
