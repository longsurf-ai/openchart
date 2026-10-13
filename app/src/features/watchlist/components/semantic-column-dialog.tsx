// Purpose: Saves a research column with the shared Agent prompt Composer.
import { useContext, useId, useState } from "react";
import { replaceEqualDeep } from "@tanstack/react-query";
import { Button } from "@openchart/app/components/ui/button";
import { Input } from "@openchart/app/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@openchart/app/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@openchart/app/components/ui/dialog";
import type { Watchlist } from "../api/queries";
import { watchlistIds } from "../utils/tree";
import { useWatchlistPlacement, WatchlistPromptEditor } from "./context";
import { useSemanticContext } from "./semantic-context";

/** Saves the complete Composer prompt and starts one all-row batch for new columns. Edits never rerun research; failed saves retain the draft, and failed admission leaves the saved column retryable. */
export function SemanticColumnDialog({
  column,
  onClose,
}: {
  column?: Watchlist["columns"][number];
  onClose: () => void;
}) {
  const id = useId();
  const [original] = useState<Watchlist["columns"][number] | undefined>(column);
  const initial =
    original?.metric.kind === "semantic" ? original.metric : undefined;
  const [title, setTitle] = useState(column?.title ?? "");
  const Editor = useContext(WatchlistPromptEditor);
  const { save } = useWatchlistPlacement();
  const { start } = useSemanticContext();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg lg:max-w-lg xl:max-w-lg"
        aria-busy={save.isPending}
      >
        <DialogHeader>
          <DialogTitle>
            {column ? "Edit research column" : "Add AI research column"}
          </DialogTitle>
          <DialogDescription>
            Ask one question for every symbol.
          </DialogDescription>
        </DialogHeader>
        {Editor ? (
          <Editor
            prompt={initial?.prompt}
            disabled={save.isPending}
            onCancel={onClose}
          >
            {(editor) => (
              <form
                className="neutral-controls"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (save.isPending || !title.trim() || !editor.ready) return;
                  const columnId = column?.id ?? watchlistIds.column.create();
                  save.mutate(
                    async (current) => {
                      const prompt = await editor.read();
                      const metric = {
                        kind: "semantic" as const,
                        prompt,
                      };
                      const index = current.columns.findIndex(
                        (entry) => entry.id === column?.id,
                      );
                      if (column && index < 0)
                        throw new Error("This column was deleted.");
                      if (
                        original &&
                        replaceEqualDeep<unknown>(
                          original,
                          current.columns[index],
                        ) !== original
                      )
                        throw new Error(
                          "This column changed while you were editing. Reopen it to load the saved settings.",
                        );
                      return column
                        ? [
                            {
                              op: "replace",
                              path: `/columns/${index}`,
                              value: {
                                ...current.columns[index],
                                title: title.trim(),
                                metric,
                              },
                            },
                          ]
                        : [
                            {
                              op: "add",
                              path: "/columns/-",
                              value: {
                                id: columnId,
                                title: title.trim(),
                                metric,
                              },
                            },
                          ];
                    },
                    {
                      onSuccess: () => {
                        if (!column) start.mutate({ columnId });
                        onClose();
                      },
                    },
                  );
                }}
              >
                <FieldSet disabled={save.isPending}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor={`${id}-name`}>
                        Column name
                      </FieldLabel>
                      <Input
                        id={`${id}-name`}
                        value={title}
                        maxLength={200}
                        onChange={(event) => setTitle(event.target.value)}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Research question</FieldLabel>
                      {editor.content}
                    </Field>
                  </FieldGroup>
                </FieldSet>
                <DialogFooter className="bg-transparent pt-6">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={save.isPending}
                    onClick={onClose}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={save.isPending || !title.trim() || !editor.ready}
                  >
                    {save.isPending ? "Saving…" : "Save column"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </Editor>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
