// Purpose: Give an agent a new instruction about a Post from the Feed, like commenting on it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2Icon, MessageSquareIcon } from "lucide-react";
import { useCopilotControls } from "@openchart/app/app/agent/copilot-controls";
import { Button } from "@openchart/app/components/ui/button";
import { Skeleton } from "@openchart/app/components/ui/skeleton";
import { TooltipIconButton } from "@openchart/app/components/ui/tooltip-icon-button/tooltip-icon-button";
import { AgentPromptEditor } from "@openchart/app/features/agent/components/prompt-editor/prompt-editor";
import type { Post } from "@openchart/app/features/posts/api/queries";
import { resolveModel } from "@openchart/app/lib/agent/model-selection";
import { useAgentContext } from "@openchart/app/lib/agent/provider";
import {
  lastUserInfo,
  useSessionSnapshot,
} from "@openchart/app/lib/agent/use-session-snapshot";
import type { PromptParts } from "@openchart/app/lib/prompt-converter/converter";
import type {
  AgentInputs,
  AppTransport,
} from "@openchart/app/lib/transport/transport";

type PromptInput = AgentInputs["prompt"]["input"];

/**
 * Open the shared composer inline under the Post, like a comment box. Sending continues the
 * Session that published it with that Session's last model and workspace, or starts one for a
 * Rule Post with the defaults, passes the Post ID as view context, then shows that Session in Copilot.
 * @example <PostInstruction post={post} transport={transport} />
 */
export function PostInstruction({
  post,
  transport,
}: {
  post: Post;
  transport: AppTransport;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TooltipIconButton
        tooltip="New instruction"
        side="top"
        className="size-7 text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MessageSquareIcon aria-hidden="true" className="size-3.5" />
      </TooltipIconButton>
      {open ? (
        <InstructionComposer
          post={post}
          transport={transport}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function InstructionComposer({
  post,
  transport,
  onClose,
}: {
  post: Post;
  transport: AppTransport;
  onClose: () => void;
}) {
  const { agent } = useAgentContext();
  const copilot = useCopilotControls();
  const origin = post.origin;
  const sessionID = origin.kind === "agent_run" ? origin.sessionId : undefined;
  // Like reopening the conversation, continue with its last model and workspace.
  const loading = useSessionSnapshot(agent, sessionID, (s) => s.loading);
  const last = useSessionSnapshot(agent, sessionID, lastUserInfo);
  const model = last?.model
    ? resolveModel(agent.modelProviders.data ?? [], last.model)
    : undefined;
  const send = useMutation({
    meta: { errorTitle: "Couldn’t send the instruction" },
    mutationFn: async (read: () => Promise<PromptInput>) => {
      const input = await read();
      const target =
        sessionID ?? (await agent.createSession.mutateAsync({})).id;
      await agent.submitPrompt.mutateAsync({
        sessionID: target,
        // The output-only Resource ID brands do not change the Parts wire contract.
        parts: input.parts as PromptParts,
        model: input.model,
        workspaceId: input.workspaceId,
        viewContext: JSON.stringify({ view: "feed", postId: post.id }),
      });
      return target;
    },
    onSuccess: (target) => {
      onClose();
      copilot?.selectSession(target);
    },
  });
  // The editor reads its initial model once, so it waits for the Session's history.
  if (loading || agent.modelProviders.isPending)
    return (
      <Skeleton
        role="status"
        aria-label="Loading session"
        className="order-last mt-1 h-24 basis-full"
      />
    );
  return (
    // The actions row wraps; the composer takes its own full-width line below the icons.
    <div className="order-last mt-1 basis-full text-foreground">
      <AgentPromptEditor
        transport={transport}
        prompt={
          model
            ? {
                agent: "analyst",
                parts: [],
                model,
                workspaceId: last?.workspaceId,
              }
            : undefined
        }
        disabled={send.isPending}
        onCancel={onClose}
      >
        {(editor) => (
          <InstructionForm
            ready={editor.ready}
            pending={send.isPending}
            onSend={() => send.mutate(editor.read)}
            onCancel={onClose}
          >
            {editor.content}
          </InstructionForm>
        )}
      </AgentPromptEditor>
    </div>
  );
}

function InstructionForm({
  ready,
  pending,
  onSend,
  onCancel,
  children,
}: {
  ready: boolean;
  pending: boolean;
  onSend: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  // Like a comment box, opening it puts the cursor in the prompt.
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-label="Prompt"]')?.focus();
  }, []);
  return (
    <form
      ref={form}
      aria-label="New instruction"
      aria-busy={pending}
      className="neutral-controls space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !pending) onSend();
      }}
    >
      {children}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready || pending}>
          {pending ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : null}
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
