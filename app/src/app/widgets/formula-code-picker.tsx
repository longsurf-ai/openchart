// Purpose: Compose the bundled study catalog and Workspace files into Formula code selection.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileCode2 } from "lucide-react";

import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import { Input } from "@openchart/app/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openchart/app/components/ui/tabs";
import {
  indicatorCatalogQueryOptions,
  resolveIndicator,
  type IndicatorSelection,
} from "@openchart/app/features/chart/api/indicator-scripts";
import type { FormulaPickerProps } from "@openchart/app/features/watchlist/components/context";
import { useWidget } from "@openchart/app/hooks/use-widget";
import { useWorkspaceTeaFiles } from "@openchart/app/lib/workspace/use-workspace-tea-files";

/**
 * Select bundled or user-authored Tea code without creating a chart attachment.
 * Query owns reads and cancellation; installation failures retain the picker.
 * The Watchlist settings flow compiles the selected code and validates its
 * numeric outputs before saving. Closing this dialog creates no column.
 * @example <FormulaCodePicker onSelect={configure} onClose={close} />
 */
export function FormulaCodePicker({ onSelect, onClose }: FormulaPickerProps) {
  const { transport } = useWidget();
  const [tab, setTab] = useState("builtins");
  const [search, setSearch] = useState("");
  const catalog = useQuery(indicatorCatalogQueryOptions(transport));
  const readFiles = tab === "workspace";
  const scripts = useWorkspaceTeaFiles(transport, {
    enabled: readFiles,
    search,
  });
  const pick = useMutation({
    mutationFn: async (selection: IndicatorSelection) =>
      onSelect(await resolveIndicator(transport, selection)),
    retry: false,
    meta: { errorTitle: "Couldn’t open this code" },
  });
  const needle = search.trim().toLocaleLowerCase();
  const entries = (catalog.data ?? []).filter((entry) =>
    `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(needle),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && !pick.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg lg:max-w-lg xl:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add formula column</DialogTitle>
          <DialogDescription>
            Choose code, then select an output and parameters for your column.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search formula code"
          placeholder="Search code…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Code source">
            <TabsTrigger value="builtins">Built-in</TabsTrigger>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
          </TabsList>
          <TabsContent value="builtins" className="max-h-80 overflow-y-auto">
            {catalog.isPending ? (
              <p role="status" className="p-3 text-sm text-muted-foreground">
                Loading code…
              </p>
            ) : catalog.isError ? (
              <div role="alert" className="space-y-2 p-3 text-sm">
                <p>Couldn’t load built-in code.</p>
                <Button variant="outline" onClick={() => catalog.refetch()}>
                  Retry
                </Button>
              </div>
            ) : entries.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No matching code.
              </p>
            ) : (
              entries.map((entry) => (
                <Button
                  key={entry.id}
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                  disabled={pick.isPending}
                  onClick={() => pick.mutate(entry.id)}
                >
                  <FileCode2 aria-hidden />
                  <span>
                    <span className="block">{entry.name}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {entry.description}
                    </span>
                  </span>
                </Button>
              ))
            )}
          </TabsContent>
          <TabsContent value="workspace" className="max-h-80 overflow-y-auto">
            {scripts.pending ? (
              <p role="status" className="p-3 text-sm text-muted-foreground">
                Reading workspaces…
              </p>
            ) : (
              <>
                {scripts.failed ? (
                  <div role="alert" className="space-y-2 p-3 text-sm">
                    <p>Some workspaces couldn’t be read.</p>
                    <Button variant="outline" onClick={scripts.retry}>
                      Retry
                    </Button>
                  </div>
                ) : null}
                {scripts.files.map((file) => (
                  <Button
                    key={`${file.workspaceId}:${file.path}`}
                    variant="ghost"
                    className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                    disabled={pick.isPending}
                    onClick={() =>
                      pick.mutate({
                        workspaceId: file.workspaceId,
                        path: file.path,
                      })
                    }
                  >
                    <FileCode2 aria-hidden />
                    <span className="min-w-0">
                      <span className="block break-all">{file.path}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {file.root.split(/[\\/]/).filter(Boolean).at(-1)}
                      </span>
                    </span>
                  </Button>
                ))}
                {!scripts.failed && scripts.files.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    {needle
                      ? "No matching code."
                      : "No Tea code in your workspaces yet."}
                  </p>
                ) : null}
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
