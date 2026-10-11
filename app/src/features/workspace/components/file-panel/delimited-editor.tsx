// Purpose: Preview delimited text as a sheet while the source tab edits the same file draft.
import { lazy, Suspense, useMemo, useState, type ComponentProps } from "react";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openchart/app/components/ui/tabs";
import { LoadingFile, ToolbarControls } from "./file-panel";

const CodeEditor = lazy(() => import("./code-editor"));
const OfficeViewer = lazy(() => import("./office-viewer"));

/** Show CSV/TSV as a read-only table or as editable source, sharing the file panel's draft. */
export default function DelimitedEditor(
  props: ComponentProps<typeof CodeEditor>,
) {
  const [mode, setMode] = useState<
    { view: "table" } | { view: "source"; reason?: Error }
  >({ view: "table" });
  // The inactive tab unmounts, so the table re-parses only when shown.
  const bytes = useMemo(
    () => new TextEncoder().encode(props.value),
    [props.value],
  );
  useErrorToast(mode.view === "source" ? mode.reason : undefined, {
    id: `delimited:${props.workspaceId}:${props.path}`,
    title: "Couldn’t show this table",
    retry: () => setMode({ view: "table" }),
  });
  const controls = (
    <TabsList aria-label="Table view">
      <TabsTrigger value="table">Table</TabsTrigger>
      <TabsTrigger value="source">Source</TabsTrigger>
    </TabsList>
  );
  return (
    <Tabs
      className="size-full min-h-0 gap-0"
      value={mode.view}
      onValueChange={(view) => {
        if (view === "table" || view === "source") setMode({ view });
      }}
    >
      <ToolbarControls>{controls}</ToolbarControls>
      <TabsContent value="table" className="min-h-0">
        <Suspense fallback={<LoadingFile />}>
          <OfficeViewer
            bytes={bytes}
            format={/\.tsv$/i.test(props.path) ? "tsv" : "csv"}
            onError={(reason) => setMode({ view: "source", reason })}
          />
        </Suspense>
      </TabsContent>
      <TabsContent value="source" className="min-h-0">
        <Suspense fallback={<LoadingFile />}>
          <CodeEditor {...props} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
