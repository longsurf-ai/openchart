// Purpose: Own one workspace editor's LSP channel, file navigation, reference lookups and reconnect lifecycle.
import { MonacoLanguageClient } from "monaco-languageclient";
import {
  CloseAction,
  ErrorAction,
  Message,
  type InitializeParams,
} from "vscode-languageclient/browser.js";
import { z } from "zod";
import { toast } from "sonner";
import * as vscode from "vscode";
import * as monaco from "monaco-editor";
import {
  getService,
  ICodeEditorService,
  ITextModelService,
} from "@codingame/monaco-vscode-api";
import {
  RegisteredFile,
  RegisteredFileSystemProvider,
  registerFileSystemOverlay,
} from "@codingame/monaco-vscode-files-service-override";
import { JsonRpcTransport } from "@openchart/hose/jsonrpc";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const DiagnosticVersion = z.object({
  uri: z.string(),
  version: z.number().int().optional(),
});

// Workspace already watches disk. Advertise notifications without installing
// another watch through the VS Code filesystem facade.
class WorkspaceLanguageClient extends MonacoLanguageClient {
  /** Reuses Workspace disk notifications instead of installing another watcher. */
  protected override fillInitializeParams(params: InitializeParams): void {
    super.fillInitializeParams(params);
    if (params.capabilities.workspace?.didChangeWatchedFiles)
      params.capabilities.workspace.didChangeWatchedFiles.dynamicRegistration = false;
  }
}

class WorkspaceFile extends RegisteredFile {
  /** Exposes a Workspace read to the editor without granting file writes. @example new WorkspaceFile(uri, readBytes); */
  constructor(
    uri: monaco.Uri,
    readonly read: () => Promise<Uint8Array>,
  ) {
    super(uri, true);
  }
  /** Reports the current byte length for the editor resolver. @example await file.getSize(); */
  async getSize() {
    return (await this.read()).length;
  }
  /** Keeps saves on the hash-checked Workspace path; direct writes reject. @example await file.write(); // rejects */
  async write(): Promise<void> {
    throw new Error("Save through the workspace editor");
  }
}

// Monaco's link gesture: ⌘ Click on a Mac, Ctrl Click elsewhere.
const mac = navigator.userAgent.includes("Mac");

/**
 * Starts Tea authoring for one mounted workspace. Monaco/LanguageClient own open
 * documents, versions and language providers. Workspace owns reads and saves.
 * Socket recovery creates a new LSP session and reopens current editor buffers.
 * The caller disposes this session when its workspace view unmounts.
 *
 * A name the Tea reference documents shows a ⌘ Click hint under its hover, and
 * ⌘ Click calls `openReference` with the name Tea's `tea/referenceName` gives,
 * such as `ta.sma`. F12 and the context menu still go to its source.
 *
 * @example const session = createTeaLanguageClient(transport, workspaceId, root, openFile, openReference, showLanguageError);
 */
export function createTeaLanguageClient(
  transport: AppTransport,
  workspaceId: string,
  root: string,
  openFile: (path: string) => void,
  openReference: (name: string) => void,
  onError: (message: string | undefined) => void,
) {
  let disposed = false;
  const reportError = (error: unknown) => {
    if (!disposed)
      onError(error instanceof Error ? error.message : String(error));
  };
  let current:
    { client: MonacoLanguageClient; close: () => Promise<void> } | undefined;
  let starting: Promise<void> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  class WorkspaceFiles extends RegisteredFileSystemProvider {
    override stat(uri: monaco.Uri) {
      registerFile(uri);
      return super.stat(uri);
    }
    override readFile(uri: monaco.Uri) {
      registerFile(uri);
      return super.readFile(uri);
    }
  }
  const provider = new WorkspaceFiles(true);
  const overlay = registerFileSystemOverlay(10, provider);
  const files = new Map<string, { dispose: () => void }>();
  const abort = new AbortController();
  const rootUri = monaco.Uri.file(root);
  const relative = (uri: { scheme: string; path: string }) => {
    const prefix = rootUri.path.replace(/\/$/, "") + "/";
    return uri.scheme === "file" && uri.path.startsWith(prefix)
      ? uri.path.slice(prefix.length)
      : undefined;
  };

  function registerFile(uri: monaco.Uri) {
    const path = relative(uri);
    if (
      disposed ||
      path === undefined ||
      !path.endsWith(".tea") ||
      files.has(path)
    )
      return;
    const registration = provider.registerFile(
      new WorkspaceFile(uri, async () => {
        const model = monaco.editor.getModel(uri);
        if (model) return new TextEncoder().encode(model.getValue());
        const file = await transport.rpc.workspace.read.query(
          { workspaceId, path },
          { signal: abort.signal },
        );
        return Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
      }),
    );
    files.set(path, registration);
  }

  // Monaco asks for the definition alike for a click and for F12, so the
  // gesture is the last pointer or key press: the key that starts F12 clears it.
  let referenceClick = false;
  const readGesture = (event: PointerEvent | KeyboardEvent) => {
    referenceClick =
      event.type === "pointerdown" && (mac ? event.metaKey : event.ctrlKey);
  };
  window.addEventListener("pointerdown", readGesture, true);
  window.addEventListener("keydown", readGesture, true);

  async function start() {
    await current?.close();
    if (disposed) return;
    let closing = false;
    // Null where the reference does not document the name, or the server
    // cannot answer: the hint and the click are extras on hover and definition.
    const referenceName = (
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
    ) =>
      relative(document.uri) === undefined
        ? Promise.resolve(null)
        : client
            .sendRequest<string | null>(
              "tea/referenceName",
              client.code2ProtocolConverter.asTextDocumentPositionParams(
                document,
                position,
              ),
              token,
            )
            .catch(() => null);
    const versions = new Map<string, number | undefined>();
    const rpc = new JsonRpcTransport((body) => channel.send(body));
    const channel = transport.hose.openChannel(
      { type: "tea.lsp" },
      {
        data: (body) => {
          try {
            rpc.receive(body);
          } catch (cause) {
            rpc.close(
              cause instanceof Error ? cause : new Error(String(cause)),
            );
            channel.close();
          }
        },
        error: (error) => rpc.close(error),
        done: () => rpc.close(),
      },
    );
    rpc.reader.onClose(() => {
      if (disposed || closing) return;
      onError("Tea language support is reconnecting…");
      retry ??= setTimeout(() => {
        retry = undefined;
        reconnect();
      }, 1_000);
    });
    const client = new WorkspaceLanguageClient({
      id: "tea",
      name: "Tea",
      messageTransports: {
        writer: rpc.writer,
        reader: {
          ...rpc.reader,
          listen: (callback) =>
            rpc.reader.listen((message) => {
              if (
                Message.isNotification(message) &&
                message.method === "textDocument/publishDiagnostics"
              ) {
                const { uri, version } = DiagnosticVersion.parse(
                  message.params,
                );
                const document = vscode.workspace.textDocuments.find(
                  (document) => document.uri.toString() === uri,
                );
                if (version !== undefined && document?.version !== version)
                  return;
                if (version === undefined) versions.delete(uri);
                else versions.set(uri, version);
              }
              callback(message);
            }),
        },
      },
      clientOptions: {
        documentSelector: [{ language: "tea", scheme: "file" }],
        workspaceFolder: {
          uri: vscode.Uri.file(root),
          name: workspaceId,
          index: 0,
        },
        middleware: {
          handleDiagnostics: (uri, diagnostics, next) => {
            const version = versions.get(uri.toString());
            const document = vscode.workspace.textDocuments.find(
              (document) => document.uri.toString() === uri.toString(),
            );
            if (version === undefined || document?.version === version)
              next(uri, diagnostics);
          },
          provideHover: async (document, position, token, next) => {
            const [hover, name] = await Promise.all([
              next(document, position, token),
              referenceName(document, position, token),
            ]);
            if (!hover || name === null) return hover;
            const hint = new vscode.MarkdownString(
              `<kbd>${mac ? "⌘" : "Ctrl"} Click</kbd> to open in the Tea reference`,
            );
            hint.supportHtml = true;
            return new vscode.Hover([...hover.contents, hint], hover.range);
          },
          provideDefinition: async (document, position, token, next) => {
            const click = referenceClick;
            referenceClick = false;
            const name = click
              ? await referenceName(document, position, token)
              : null;
            if (name === null) return next(document, position, token);
            openReference(name);
            // Monaco mutes "no definition" for a click.
            return null;
          },
        },
        errorHandler: {
          error: () => ({ action: ErrorAction.Continue }),
          closed: () => ({ action: CloseAction.DoNotRestart }),
        },
      },
    });
    const started = client.start();
    current = {
      client,
      close: async () => {
        closing = true;
        try {
          // LanguageClient cannot stop while initialize is still pending.
          await started;
          await client.dispose();
        } finally {
          channel.close();
          rpc.dispose();
        }
      },
    };
    await started;
    if (!disposed) {
      onError(undefined);
    }
  }

  const reconnect = () => {
    if (disposed || starting || current?.client.isRunning()) return;
    clearTimeout(retry);
    retry = undefined;
    starting = Promise.resolve()
      .then(start)
      .catch(reportError)
      .finally(() => {
        starting = undefined;
      });
  };
  // onState immediately reports the current socket state. The initial open also
  // connects a previously idle Hose client; no second WebSocket is constructed.
  const stopState = transport.hose.onState((state) => {
    if (state === "connected" && !current?.client.isRunning()) reconnect();
  });
  reconnect();
  async function readLibrary(uri: string): Promise<string> {
    await starting;
    if (disposed || !current?.client.isRunning())
      throw new Error("Tea language service is unavailable");
    const text = await current.client.sendRequest<string | null>(
      "tea/libraryText",
      { uri },
    );
    if (text === null) throw new Error("Tea library source was not found");
    return text;
  }
  let libraryProvider: { dispose(): void } | undefined;
  void getService(ITextModelService)
    .then((service) => {
      if (disposed) return;
      libraryProvider = service.registerTextModelContentProvider("tea-lib", {
        async provideTextContent(uri) {
          const text = await readLibrary(uri.toString());
          if (disposed) return null;
          // Navigation and a React tab may request the same source concurrently.
          // Monaco owns the unique model for its URI; reuse it after the read.
          return (
            monaco.editor.getModel(uri) ??
            monaco.editor.createModel(text, "tea", uri)
          );
        },
      });
    })
    .catch(reportError);

  let stopOpener: { dispose(): void } | undefined;
  void getService(ICodeEditorService)
    .then((editors) => {
      if (disposed) return;
      stopOpener = editors.registerCodeEditorOpenHandler(async (input) => {
        const uri = input.resource;
        if (!uri) return null;
        const path = uri.scheme === "tea-lib" ? uri.toString() : relative(uri);
        if (disposed || path === undefined) return null;
        const existing = editors
          .listCodeEditors()
          .find(
            (editor) => editor.getModel()?.uri.toString() === uri.toString(),
          );
        const ready = existing
          ? Promise.resolve(existing)
          : new Promise<monaco.editor.ICodeEditor>((resolve, reject) => {
              const signal = AbortSignal.any([
                abort.signal,
                AbortSignal.timeout(10_000),
              ]);
              const stop = editors.onCodeEditorAdd((editor) => {
                queueMicrotask(() => {
                  if (editor.getModel()?.uri.toString() === uri.toString()) {
                    cleanup();
                    resolve(editor);
                  }
                });
              });
              const cancel = () => {
                cleanup();
                reject(signal.reason);
              };
              const cleanup = () => {
                stop.dispose();
                signal.removeEventListener("abort", cancel);
              };
              signal.addEventListener("abort", cancel, { once: true });
            });
        openFile(path);
        const editor = await ready;
        if (input.options?.selection) {
          const {
            startLineNumber,
            startColumn,
            endLineNumber = startLineNumber,
            endColumn = startColumn,
          } = input.options.selection;
          const range = new monaco.Range(
            startLineNumber,
            startColumn,
            endLineNumber,
            endColumn,
          );
          editor.setSelection(range);
          editor.revealRangeInCenter(range);
        }
        editor.focus();
        return editor;
      });
    })
    .catch(reportError);

  return {
    /** Keeps a Tea editor's model alive while definition/peek references come and go. Release the returned reference when the editor closes. @example const ref = await session.retainModel(uri); */
    async retainModel(uri: string) {
      await starting;
      if (disposed) throw new Error("Tea language session is closed");
      return (await getService(ITextModelService)).createModelReference(
        monaco.Uri.parse(uri),
      );
    },
    /** Reads compiler-shipped source for a read-only library tab. @example await session.readLibrary("tea-lib:/ta.tea"); */
    readLibrary,
    /** Ends this session and releases its filesystem view, leaving other Hose channels running. @example session.dispose(); */
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      window.removeEventListener("pointerdown", readGesture, true);
      window.removeEventListener("keydown", readGesture, true);
      clearTimeout(retry);
      stopState();
      stopOpener?.dispose();
      libraryProvider?.dispose();
      files.forEach((file) => file.dispose());
      files.clear();
      void current?.close().catch((error: unknown) => {
        toast.error("Couldn’t stop Tea language service", {
          id: `tea-language-close:${workspaceId}`,
          description: error instanceof Error ? error.message : String(error),
        });
      });
      overlay.dispose();
      provider.dispose();
    },
  };
}

/** One view's cleanup handle; it owns no editor text copies. */
export type TeaLanguageSession = ReturnType<typeof createTeaLanguageClient>;
