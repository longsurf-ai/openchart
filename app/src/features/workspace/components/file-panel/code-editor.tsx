// Purpose: Bind Workspace models and Tea language sessions to the shared Monaco editor.
import { CodeEditor as Editor } from "@openchart/app/components/ui/code-editor";
import { useWorkspaceView } from "@openchart/app/features/workspace/components/context";
import { createTeaLanguageClient } from "@openchart/app/features/workspace/api/tea-language-client";

/** Mount and focus one file model with automatic container sizing. @example <CodeEditor {...fileProps} /> */
export default function CodeEditor({
  path,
  workspaceRoot,
  workspaceId,
  onOpenFile,
  value,
  readOnly = false,
  wordWrap = false,
  onChange,
}: {
  path: string;
  workspaceRoot: string;
  workspaceId: string;
  onOpenFile: (path: string) => void;
  value: string;
  readOnly?: boolean;
  wordWrap?: boolean;
  onChange: (value: string) => void;
}) {
  const { transport, teaSessions, onLanguageError, openReference } =
    useWorkspaceView();
  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          path={path}
          keepCurrentModel={path.endsWith(".tea")}
          language={
            path.endsWith(".tea")
              ? "tea"
              : path.endsWith(".ts")
                ? "typescript"
                : /\.(md|markdown)$/i.test(path)
                  ? "markdown"
                  : "plaintext"
          }
          value={value}
          onMount={(editor) => {
            editor.focus();
            if (path.endsWith(".tea")) {
              const model = editor.getModel();
              let active = true;
              let reference: { dispose(): void } | undefined;
              editor.onDidDispose(() => {
                active = false;
                if (reference) reference.dispose();
                else model?.dispose();
              });
              let session = teaSessions.current.get(workspaceId);
              if (!session && !path.startsWith("tea-lib:")) {
                session = createTeaLanguageClient(
                  transport,
                  workspaceId,
                  workspaceRoot,
                  onOpenFile,
                  openReference,
                  onLanguageError,
                );
                teaSessions.current.set(workspaceId, session);
              }
              void session
                ?.retainModel(path)
                .then((ref) => {
                  if (active) reference = ref;
                  else ref.dispose();
                })
                .catch((error) => {
                  if (active)
                    onLanguageError(
                      error instanceof Error ? error.message : String(error),
                    );
                });
            }
          }}
          onChange={(next) => onChange(next ?? "")}
          options={{ readOnly, wordWrap: wordWrap ? "on" : "off" }}
        />
      </div>
    </div>
  );
}
