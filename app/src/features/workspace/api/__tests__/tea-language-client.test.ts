// Purpose: Closing a view during LSP initialization must finish shutdown without leaking its channel; ⌘ Click opens the Tea reference.
import { Subscription } from "rxjs";
import { expect, test, vi } from "vitest";
import { toast } from "sonner";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { createTeaLanguageClient } from "@openchart/app/features/workspace/api/tea-language-client";

const language = vi.hoisted(() => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  return {
    ready,
    start: vi.fn(() => started),
    dispose: vi.fn(async () => {}),
    sendRequest: vi.fn(),
    middleware: undefined as
      | undefined
      | {
          provideDefinition: (...args: unknown[]) => Promise<unknown>;
        },
  };
});

vi.mock("monaco-languageclient", () => ({
  MonacoLanguageClient: class {
    start = language.start;
    dispose = language.dispose;
    sendRequest = language.sendRequest;
    code2ProtocolConverter = { asTextDocumentPositionParams: () => ({}) };
    constructor(options: {
      clientOptions: { middleware: typeof language.middleware };
    }) {
      language.middleware = options.clientOptions.middleware;
    }
    isRunning() {
      return false;
    }
  },
}));
vi.mock("vscode-languageclient/browser.js", () => ({
  CloseAction: { DoNotRestart: 1 },
  ErrorAction: { Continue: 1 },
  Message: { isNotification: () => false },
}));
vi.mock("vscode", () => ({
  Uri: { file: (path: string) => ({ path }) },
}));
vi.mock("monaco-editor", () => ({
  Uri: { file: (path: string) => ({ path }) },
}));
vi.mock("@codingame/monaco-vscode-api", () => ({
  ICodeEditorService: "editor",
  ITextModelService: "model",
  getService: async () => ({
    registerTextModelContentProvider: () => ({ dispose() {} }),
    registerCodeEditorOpenHandler: () => ({ dispose() {} }),
  }),
}));
vi.mock("@codingame/monaco-vscode-files-service-override", () => ({
  RegisteredFile: class {},
  RegisteredFileSystemProvider: class {
    dispose() {}
  },
  registerFileSystemOverlay: () => ({ dispose() {} }),
}));

test("waits for initialization before disposing the client and closes only once", async () => {
  const transport = createTransport({ origin: "http://127.0.0.1:41000" });
  const close = vi.fn();
  vi.spyOn(transport.hose, "openChannel").mockReturnValue({
    send: vi.fn(),
    close,
  });
  vi.spyOn(transport.hose, "onState").mockReturnValue(() => {});
  vi.spyOn(transport.events, "subscribe").mockReturnValue(new Subscription());
  const report = vi.fn();
  const session = createTeaLanguageClient(
    transport,
    "default",
    "/workspace",
    () => {},
    () => {},
    report,
  );
  await vi.waitFor(() => expect(language.start).toHaveBeenCalledOnce());

  session.dispose();
  session.dispose();
  expect(language.dispose).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();

  language.ready();
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(language.dispose).toHaveBeenCalledOnce();
  expect(report).not.toHaveBeenCalled();
  expect(toast.getToasts()).toHaveLength(0);
});

test("⌘ Click on a documented name opens the reference; F12 still goes to the source", async () => {
  const transport = createTransport({ origin: "http://127.0.0.1:41000" });
  vi.spyOn(transport.hose, "openChannel").mockReturnValue({
    send: vi.fn(),
    close: vi.fn(),
  });
  vi.spyOn(transport.hose, "onState").mockReturnValue(() => {});
  language.middleware = undefined;
  const openReference = vi.fn();
  const session = createTeaLanguageClient(
    transport,
    "default",
    "/workspace",
    () => {},
    openReference,
    () => {},
  );
  await vi.waitFor(() => expect(language.middleware).toBeDefined());
  const definition = (next: () => string) =>
    language.middleware!.provideDefinition(
      { uri: { scheme: "file", path: "/workspace/main.tea" } },
      {},
      {},
      next,
    );
  language.sendRequest.mockResolvedValue("ta.sma");
  // Monaco's link gesture is ⌘ Click on a Mac and Ctrl Click elsewhere.
  window.dispatchEvent(
    new MouseEvent("pointerdown", { metaKey: true, ctrlKey: true }),
  );
  expect(await definition(() => "source")).toBeNull();
  expect(openReference).toHaveBeenCalledExactlyOnceWith("ta.sma");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F12" }));
  expect(await definition(() => "source")).toBe("source");
  expect(openReference).toHaveBeenCalledOnce();
  session.dispose();
});
