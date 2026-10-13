// Purpose: Constructs ordinary prompts and opens existing Agent threads for a Watchlist.
import { createContext, useContext, type PropsWithChildren } from "react";
import {
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import { useWidget } from "@openchart/app/hooks/use-widget";
import { useAgentContext } from "@openchart/app/lib/agent/provider";
import { useBoundSession } from "@openchart/app/lib/agent/use-bound-session";
import { activeRun } from "@openchart/app/lib/agent/session-progress";
import type {
  AgentInputs,
  AgentSessionState,
} from "@openchart/app/lib/transport/transport";
import { watchlistDetail, type Watchlist } from "../api/queries";
import { columnTitle } from "../utils/columns";

const WORKFLOW = "default:workflows/watchlist-semantic-column.workflow.ts";
type StartInput = { columnId: string; itemIds?: string[] };
type Run = AgentSessionState["runs"][number];

/** Root binding reuses the ordinary per-Session queue for repeated column refreshes. */
export const columnBinding = (watchlistId: string, columnId: string) =>
  `watchlist:${watchlistId}:column:${columnId}`;
/** Execution and display independently resolve the same opaque cell address. */
export const cellBinding = (
  watchlistId: string,
  columnId: string,
  itemId: string,
) => `${columnBinding(watchlistId, columnId)}:item:${itemId}`;
function useSemantic(watchlist: Watchlist) {
  const { agent } = useAgentContext();
  const { transport } = useWidget();
  const client = useQueryClient();
  const mutationKey = ["watchlist-research", watchlist.id];
  const start = useMutation({
    mutationKey,
    retry: false,
    meta: { errorTitle: "Couldn’t start research" },
    mutationFn: async ({ columnId, itemIds }: StartInput): Promise<Run> => {
      // Creation may have just saved, before this provider has rendered again.
      const saved = client.getQueryData<Watchlist | null>(
        watchlistDetail(transport, watchlist.id).queryKey,
      );
      const current = saved === undefined ? watchlist : saved;
      if (!current) throw new Error("This watchlist was deleted.");
      const column =
        current.columns[
          current.columns.findIndex((column) => column.id === columnId)
        ];
      if (column?.metric.kind !== "semantic")
        throw new Error("This research column was deleted.");
      // Resource reads serialize Parts; restore their canonical input type at admission.
      const prompt = column.metric
        .prompt as unknown as AgentInputs["prompt"]["input"];
      const session = await agent.getOrCreateBoundSession.mutateAsync({
        key: columnBinding(watchlist.id, columnId),
        kind: "chat",
        title: `${current.name} · ${columnTitle(column)}`,
      });
      return agent.submitPrompt.mutateAsync({
        ...prompt,
        sessionID: session.id,
        parts: [
          {
            type: "workflow",
            workflow: WORKFLOW,
            args: {
              watchlistId: watchlist.id,
              columnId,
              prompt,
              ...(itemIds ? { itemIds } : {}),
            },
          },
        ],
      });
    },
  });
  const submissions = useMutationState({
    filters: { mutationKey },
    select: ({ state }) => ({
      status: state.status,
      variables: state.variables as StartInput | undefined,
      data: state.data as Run | undefined,
    }),
  });
  return { watchlist, start, submissions };
}
const SemanticContext = createContext<ReturnType<typeof useSemantic> | null>(
  null,
);
/** Shares prompt controls only; Resource reads and Agent streams retain their existing owners. */
export function SemanticProvider({
  watchlist,
  children,
}: PropsWithChildren<{ watchlist: Watchlist }>) {
  const value = useSemantic(watchlist);
  return (
    <SemanticContext.Provider value={value}>
      {children}
    </SemanticContext.Provider>
  );
}
/** Reads research controls inside the Watchlist provider; throws when composition is missing. @example const { start } = useSemanticContext(); */
export function useSemanticContext() {
  const context = useContext(SemanticContext);
  if (!context) throw new Error("Research controls need SemanticProvider.");
  return context;
}

const workflowRequest = z.object({
  type: z.literal("workflow"),
  workflow: z.literal(WORKFLOW),
  args: z.object({
    watchlistId: z.string(),
    columnId: z.string(),
    itemIds: z.array(z.string()).optional(),
  }),
});

/**
 * Shares column controls with cells through the existing bound Session.
 * Admission receipts bridge the interval before streamed state arrives; the
 * committed workflow prompt restores row targets after remount. No execution
 * state is stored here. Missing bindings never create or submit a Session.
 * @example const { busy, request } = useSemanticColumn(columnId);
 */
export function useSemanticColumn(columnId: string) {
  const { watchlist, submissions } = useSemanticContext();
  const { transport } = useWidget();
  const bound = useBoundSession(
    transport,
    columnBinding(watchlist.id, columnId),
  );
  const run = activeRun(bound.snapshot.state);
  const submission = submissions
    .slice()
    .reverse()
    .find((entry) => entry.variables?.columnId === columnId);
  const receipt =
    submission?.status === "success" ? submission.data : undefined;
  const admitted = receipt
    ? (bound.snapshot.state?.runs.find((entry) => entry.id === receipt.id) ??
      receipt)
    : undefined;
  const accepting = submission?.status === "pending";
  const admissionActive =
    admitted?.status === "queued" || admitted?.status === "running";
  const busy = accepting || admissionActive || !!bound.progress;
  let request: { itemIds?: string[]; createdAt: number } | undefined;
  if (accepting || admissionActive) {
    request = {
      itemIds: submission?.variables?.itemIds,
      createdAt: receipt?.createdAt ?? Infinity,
    };
  } else if (run) {
    request =
      run.status === "queued" ? { createdAt: run.createdAt } : undefined;
    const message = bound.snapshot.messages
      .slice()
      .reverse()
      .find(
        (entry) =>
          entry.role === "user" &&
          entry.metadata?.openchart?.createdAt >= run.createdAt,
      );
    const parts: unknown[] = message?.metadata?.parts ?? [];
    for (const part of parts) {
      const parsed = workflowRequest.safeParse(part);
      if (
        parsed.success &&
        parsed.data.args.watchlistId === watchlist.id &&
        parsed.data.args.columnId === columnId
      ) {
        request = {
          itemIds: parsed.data.args.itemIds,
          createdAt: run.createdAt,
        };
        break;
      }
    }
  }
  return { bound, busy, request };
}
