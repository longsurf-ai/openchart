// Purpose: Share one mounted file view's transport and theme with its Dockview panels.
import {
  createContext,
  useContext,
  type ReactNode,
  type MutableRefObject,
} from "react";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

import type { TeaLanguageSession } from "@openchart/app/features/workspace/api/tea-language-client";

export type WorkspaceContextValue = {
  transport: AppTransport;
  languageError: string | undefined;
  onLanguageError: (message: string | undefined) => void;
  teaSessions: MutableRefObject<Map<string, TeaLanguageSession>>;
  /** Opens the view's Tea reference, at the entry documenting `name` (such as `ta.sma`) when given. */
  openReference: (name?: string) => void;
  /** Each editor tab's current save, keyed by Dockview panel ID and removed on unmount. It resolves at once when there is nothing to save and rejects when the write fails. */
  saves: MutableRefObject<Map<string, () => Promise<void>>>;
  /** Optional view filter for widgets; each file's identity comes from panel parameters. */
  workspaceId?: string;
  instanceId: string;
  /** Widgets may collapse the file panel; the full page keeps it open. */
  collapsible: boolean;
  dark: boolean;
  actions?: ReactNode;
  navigation?: ReactNode;
};
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null,
);
/** Read the containing file view; panels never own a second backend connection. @example const { transport } = useWorkspaceView(); */
export function useWorkspaceView() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace panel requires WorkspaceView");
  return value;
}
