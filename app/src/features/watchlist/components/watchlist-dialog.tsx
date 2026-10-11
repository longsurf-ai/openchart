// Purpose: Name Watchlists and sections, and confirm deleting their contents.
import { useState } from "react";

import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import { Input } from "@openchart/app/components/ui/input";

import type { WatchlistAction } from "./context";

const copy = {
  "new-section": { title: "New section", action: "Create section" },
  section: { title: "Rename section", action: "Rename" },
  "new-watchlist": { title: "New watchlist", action: "Create watchlist" },
  watchlist: { title: "Rename watchlist", action: "Rename" },
  "delete-watchlist": { title: "Delete watchlist", action: "Delete watchlist" },
  "delete-section": { title: "Delete section", action: "Delete section" },
} as const;

/** Submit a trimmed name and close only after saving. Rejected saves keep the draft; the mutation owns error reporting. A section may clear its heading, a Watchlist may not. @example <WatchlistDialog target={target} pending={save.isPending} onSubmit={save.mutateAsync} onClose={close} /> */
export function WatchlistDialog({
  target,
  pending,
  onSubmit,
  onClose,
}: {
  target: WatchlistAction;
  pending: boolean;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(
    target.kind === "section" || target.kind === "watchlist"
      ? (target.name ?? "")
      : "",
  );
  const { title, action } = copy[target.kind];
  const deleting =
    target.kind === "delete-watchlist" || target.kind === "delete-section";
  const required = !deleting && target.kind !== "section";
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) void onSubmit(name.trim()).then(onClose, () => {});
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {deleting ? (
              <DialogDescription>
                Delete “{target.name ?? "this section"}” and its contents? This
                cannot be undone.
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {!deleting ? (
            <Input
              aria-label="Name"
              maxLength={200}
              value={name}
              placeholder={required ? undefined : "No heading"}
              onChange={(event) => setName(event.target.value)}
              className="my-4"
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={deleting ? "destructive" : "default"}
              disabled={pending || (required && !name.trim())}
            >
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
