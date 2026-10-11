// Purpose: Name a new section, rename a section, or rename the Watchlist in one small form.
import { useState } from "react";

import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import { Input } from "@openchart/app/components/ui/input";

import type { NameTarget } from "./context";

const copy = {
  "new-section": { title: "New section", action: "Create section" },
  section: { title: "Rename section", action: "Rename" },
  "new-watchlist": { title: "New watchlist", action: "Create watchlist" },
  watchlist: { title: "Rename watchlist", action: "Rename" },
} as const;

/** Submit a trimmed name and close only after saving. Rejected saves keep the draft; the mutation owns error reporting. A section may clear its heading, a Watchlist may not. @example <NameDialog target={target} pending={save.isPending} onSubmit={save.mutateAsync} onClose={close} /> */
export function NameDialog({
  target,
  pending,
  onSubmit,
  onClose,
}: {
  target: NameTarget;
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
  const required = target.kind !== "section";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) void onSubmit(name.trim()).then(onClose, () => {});
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="Name"
            maxLength={200}
            value={name}
            placeholder={required ? undefined : "No heading"}
            onChange={(event) => setName(event.target.value)}
            className="my-4"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
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
