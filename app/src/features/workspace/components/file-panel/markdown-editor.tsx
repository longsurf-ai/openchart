// Purpose: Offer Crepe editing and a byte-preserving source fallback within the existing file draft.
import { lazy, Suspense, useState, type ComponentProps } from "react";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openchart/app/components/ui/tabs";
import CrepeEditor from "./crepe-editor";
import { LoadingFile } from "./file-panel";

const CodeEditor = lazy(() => import("./code-editor"));

/** Edit Markdown visually or as source, sharing the file panel's draft. */
export default function MarkdownEditor(
  props: ComponentProps<typeof CodeEditor>,
) {
  const [mode, setMode] = useState<
    { view: "edit" } | { view: "source"; reason?: string | Error }
  >({ view: "edit" });
  useErrorToast(
    mode.view === "source" && mode.reason instanceof Error
      ? mode.reason
      : undefined,
    {
      id: `markdown:${props.workspaceId}:${props.path}`,
      title: "Couldn’t open Markdown editor",
      retry: () => setMode({ view: "edit" }),
    },
  );
  return (
    <Tabs
      className="size-full min-h-0 gap-0"
      value={mode.view}
      onValueChange={(view) => {
        if (view === "edit" || view === "source") setMode({ view });
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1">
        <TabsList aria-label="Markdown view">
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
        </TabsList>
        {mode.view === "source" && typeof mode.reason === "string" ? (
          <p role="status" className="text-xs text-muted-foreground">
            {mode.reason}
          </p>
        ) : null}
      </div>
      <TabsContent value="edit" className="min-h-0">
        <CrepeEditor
          value={props.value}
          onChange={props.onChange}
          onUnavailable={(reason) => setMode({ view: "source", reason })}
        />
      </TabsContent>
      <TabsContent value="source" className="min-h-0">
        <Suspense fallback={<LoadingFile />}>
          <CodeEditor {...props} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
