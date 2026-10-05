// Purpose: Initialize one bundled Monaco/VS Code runtime for every code surface.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { MonacoVscodeApiWrapper } from "monaco-languageclient/vscodeApiWrapper";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TypeScriptWorker from "@codingame/monaco-vscode-standalone-typescript-language-features/worker?worker";
import TextMateWorker from "@codingame/monaco-vscode-textmate-service-override/worker?worker";
import "@codingame/monaco-vscode-standalone-languages";
import * as typescript from "@codingame/monaco-vscode-standalone-typescript-language-features";
import { whenReady as typescriptGrammarReady } from "@codingame/monaco-vscode-typescript-basics-default-extension";
import grammar from "@openchart/tea-editor/syntaxes/tea.tmLanguage.json?url";
import workflowTypes from "virtual:workflow-types";
import configuration from "@openchart/tea-editor/language-configuration.json?url";
import { toast } from "sonner";

/** Shared initialization; editors wait for it before creating models. This owner reports failure once for all editors. */
export const monacoReady = new MonacoVscodeApiWrapper({
  $type: "extended",
  viewsConfig: {
    $type: "EditorService",
    openEditorFunc: async () => undefined,
  },
  monacoWorkerFactory: () => {
    self.MonacoEnvironment = {
      getWorker: (_id, label) => {
        if (label === "typescript" || label === "javascript")
          return new TypeScriptWorker();
        if (label === "TextMateWorker") return new TextMateWorker();
        return new EditorWorker();
      },
    };
  },
  extensions: [
    {
      config: {
        name: "tea-language-support",
        publisher: "longsurf",
        version: "0.3.0",
        engines: { vscode: "*" },
        contributes: {
          languages: [
            {
              id: "tea",
              extensions: [".tea"],
              aliases: ["Tea"],
              configuration: "./language-configuration.json",
            },
          ],
          grammars: [
            {
              language: "tea",
              scopeName: "source.tea",
              path: "./tea.tmLanguage.json",
            },
          ],
        },
      },
      filesOrContents: new Map([
        ["tea.tmLanguage.json", new URL(grammar, window.location.href)],
        [
          "language-configuration.json",
          new URL(configuration, window.location.href),
        ],
      ]),
    },
  ],
})
  .start()
  .then(async () => {
    // The wrapper imports themes without awaiting their registration. An editor
    // mounted before this barrier silently loses its initial setTheme request.
    const themes =
      await import("@codingame/monaco-vscode-theme-defaults-default-extension");
    await Promise.all([themes.whenReady(), typescriptGrammarReady()]);
    loader.config({ monaco });
    typescript.typescriptDefaults.setCompilerOptions({
      target: typescript.ScriptTarget.ESNext,
      lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
      module: typescript.ModuleKind.ESNext,
      moduleResolution: typescript.ModuleResolutionKind.NodeJs,
      strict: true,
      noEmit: true,
      paths: { "@openchart/workflow": [workflowTypes.entry] },
    });
    typescript.typescriptDefaults.setExtraLibs(workflowTypes.files);
  });

void monacoReady.catch((cause: unknown) => {
  toast.error("Couldn’t start the code editor", {
    id: "code-editor-start",
    description: cause instanceof Error ? cause.message : String(cause),
  });
});
