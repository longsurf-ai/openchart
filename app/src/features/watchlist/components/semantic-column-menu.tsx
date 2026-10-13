// Purpose: Column-level research controls use the ordinary bound root Session.
import { useContext, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@openchart/app/components/ui/dropdown";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@openchart/app/components/ui/dialog";
import { useAgentContext } from "@openchart/app/lib/agent/provider";
import type { Watchlist } from "../api/queries";
import { columnTitle } from "../utils/columns";
import { useWatchlistPlacement, WatchlistOpenSession } from "./context";
import { useSemanticColumn, useSemanticContext } from "./semantic-context";
import { SemanticColumnDialog } from "./semantic-column-dialog";

/** Editing, refreshing and stopping leave execution ownership with the Agent. */
export function SemanticColumnMenu({
  column,
}: {
  column: Watchlist["columns"][number];
}) {
  const { agent } = useAgentContext();
  const { start } = useSemanticContext();
  const openSession = useContext(WatchlistOpenSession);
  const { save } = useWatchlistPlacement();
  const { bound, busy } = useSemanticColumn(column.id);
  const [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false);
  const stop = useMutation({
    mutationFn: () => agent.getSession(bound.session!.id).cancel(),
    meta: { errorTitle: "Couldn’t stop research" },
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${columnTitle(column)} column actions`}
          >
            <MoreHorizontal className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => start.mutate({ columnId: column.id })}
          >
            Generate all rows
          </DropdownMenuItem>
          {bound.session ? (
            <DropdownMenuItem onSelect={() => openSession?.(bound.session!.id)}>
              Open workflow thread
            </DropdownMenuItem>
          ) : null}
          {busy && bound.session ? (
            <DropdownMenuItem
              disabled={stop.isPending}
              onSelect={() => stop.mutate()}
            >
              Stop research
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            Edit research column
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDeleting(true)}>
            Delete column
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing ? (
        <SemanticColumnDialog
          column={column}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogTitle>Delete research column</DialogTitle>
          <DialogDescription>
            Remove this column from this Watchlist? Its answers remain in their
            Agent threads.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(
                  (current) => {
                    const index = current.columns.findIndex(
                      (item) => item.id === column.id,
                    );
                    return index < 0
                      ? []
                      : [{ op: "remove", path: `/columns/${index}` }];
                  },
                  { onSuccess: () => setDeleting(false) },
                )
              }
            >
              Delete column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
