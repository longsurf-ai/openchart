// Purpose: Implements the AI SDK language model as one headless Antigravity CLI turn per request.
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { generateId, parseProviderOptions } from "@ai-sdk/provider-utils";
import type { Continuation } from "@openchart/models/providers/continuation";
import { collectGeneration } from "@openchart/models/providers/generate";
import { z } from "zod";
import { parseEvent } from "./events";
import { convertPrompt, turnText } from "./history";
import {
  startHostToolServer,
  type HostTool,
  type HostToolServer,
} from "./host-tools";
import { ensureHostToolConfig } from "./native-config";
import { TurnTranslator } from "./translate";

export const ANTIGRAVITY_PROVIDER = "antigravity";

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const STDERR_LIMIT = 4096;
/** A CLI that ignores SIGINT is killed after this grace period. */
const KILL_AFTER_MS = 5_000;
/** An exited Windows CLI can leave descendants holding its inherited pipes. */
const CLOSE_AFTER_EXIT_MS = 250;

const ProviderOptions = z.object({
  cwd: z.string().optional(),
  effort: z.string().optional(),
  /** `--dangerously-skip-permissions`; otherwise unapproved native actions are denied. */
  skipPermissions: z.boolean().optional(),
  tools: z
    .custom<Record<string, HostTool>>(
      (value) => typeof value === "object" && value !== null,
    )
    .optional(),
});

/** Request-scoped options under the `antigravity` provider namespace. */
export type AntigravityProviderOptions = z.infer<typeof ProviderOptions>;

export interface AntigravityLanguageModelOptions {
  modelId: string;
  executable: string;
  env: Record<string, string>;
  continuation: Continuation;
  /** Aborts every request when the provider is disposed. */
  disposal: AbortSignal;
  /** The provider awaits these request acquisitions and child-process lifetimes during disposal. */
  pendingProcesses: Set<Promise<void>>;
}

/**
 * Each call owns one `--input-format stream-json` CLI process that runs a
 * single turn. An append-only prompt resumes the remembered conversation with
 * only the new user message; otherwise a fresh conversation receives the
 * system instructions and replayed transcript as text. OpenChart tools run
 * in-process behind the host MCP server. Abort sends SIGINT on Unix and kills
 * the process tree on Windows. An interrupted stream settles even when the
 * CLI exits without a final result; process and pipe cleanup are bounded.
 * @example const model = provider.languageModel("gemini-3.1-pro");
 */
export class AntigravityLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = ANTIGRAVITY_PROVIDER;
  readonly supportedUrls = {};
  readonly modelId: string;

  constructor(private readonly options: AntigravityLanguageModelOptions) {
    this.modelId = options.modelId;
  }

  async doStream(
    call: LanguageModelV4CallOptions,
  ): Promise<Awaited<ReturnType<LanguageModelV4["doStream"]>>> {
    call.abortSignal?.throwIfAborted();
    this.options.disposal.throwIfAborted();
    let release!: () => void;
    const lifetime = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.options.pendingProcesses.add(lifetime);
    const closed = () => {
      this.options.pendingProcesses.delete(lifetime);
      release();
    };
    try {
      return await this.startStream(call, closed);
    } catch (error) {
      closed();
      throw error;
    }
  }

  private async startStream(
    call: LanguageModelV4CallOptions,
    closed: () => void,
  ): Promise<Awaited<ReturnType<LanguageModelV4["doStream"]>>> {
    const request =
      (await parseProviderOptions({
        provider: ANTIGRAVITY_PROVIDER,
        providerOptions: call.providerOptions,
        schema: ProviderOptions,
      })) ?? {};
    const prompt = convertPrompt(call.prompt);
    const tools = request.tools ?? {};
    const toolNames = Object.keys(tools);
    // Changing tools, instructions or policy starts a fresh conversation.
    const configuration = JSON.stringify({
      skipPermissions: request.skipPermissions === true,
      system: prompt.system,
      tools: Object.entries(tools).map(([name, tool]) => [
        name,
        tool.description,
        z.toJSONSchema(tool.inputSchema),
      ]),
    });
    const { continuation, env, executable } = this.options;
    const home =
      (process.platform === "win32" ? env.USERPROFILE : env.HOME) ??
      os.homedir();
    let resume = continuation.take(call.prompt, configuration);
    // A remembered conversation may have been deleted; check before committing input to it.
    if (
      resume &&
      !existsSync(
        path.join(
          home,
          ".gemini",
          "antigravity-cli",
          "conversations",
          `${resume}.db`,
        ),
      )
    )
      resume = undefined;
    const effort = request.effort ?? call.reasoning;
    const content = turnText(prompt, resume === undefined);
    const jsonSchema =
      call.responseFormat?.type === "json"
        ? call.responseFormat.schema
        : undefined;
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--disable-slash-commands",
      "--model",
      this.modelId,
      ...(effort && EFFORTS.has(effort) ? ["--effort", effort] : []),
      ...(resume ? ["--conversation", resume] : []),
      ...(request.skipPermissions ? ["--dangerously-skip-permissions"] : []),
      ...(jsonSchema ? ["--json-schema", JSON.stringify(jsonSchema)] : []),
    ];

    let controller!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: (next) => {
        controller = next;
      },
      // A cancelled consumer takes no more parts; the CLI is still told to stop.
      cancel: () => settle(interrupt),
    });
    let conversationId: string | undefined;
    let host: HostToolServer | undefined;
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      call.abortSignal?.removeEventListener("abort", interrupt);
      host?.close();
      finish();
    };
    const translator = new TurnTranslator({
      jsonMode: call.responseFormat?.type === "json",
      emit: (part) => {
        if (!settled) controller.enqueue(part);
      },
      onConversation: (id) => {
        conversationId = id;
      },
      onFinished: (status) =>
        settle(() => {
          if (status === "completed" && conversationId)
            continuation.keep(call.prompt, configuration, conversationId);
          controller.close();
        }),
    });

    if (toolNames.length > 0) {
      await ensureHostToolConfig(home);
      host = await startHostToolServer(tools, call.abortSignal, {
        started: (id, name, input) =>
          translator.hostToolStarted(id, name, input),
        finished: (id, name, output, isError) =>
          translator.hostToolFinished(id, name, output, isError),
      });
    }
    if (call.abortSignal?.aborted || this.options.disposal.aborted) {
      host?.close();
      call.abortSignal?.throwIfAborted();
      this.options.disposal.throwIfAborted();
    }
    const child = spawn(executable, args, {
      cwd: request.cwd,
      env: { ...env, ...host?.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let interrupted = false;
    let killTimer: NodeJS.Timeout | undefined;
    let closeTimer: NodeJS.Timeout | undefined;
    const running = () => child.exitCode === null && child.signalCode === null;
    const terminate = (signal: NodeJS.Signals) => {
      if (!running()) return;
      if (process.platform !== "win32" || child.pid === undefined) {
        child.kill(signal);
        return;
      }
      // Windows signals kill only the immediate process. Kill the tree while
      // the parent still exists, including shell tools and the MCP relay.
      execFile(
        path.win32.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "taskkill.exe",
        ),
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, timeout: KILL_AFTER_MS },
        (error) => {
          if (error && running()) child.kill("SIGKILL");
        },
      );
    };
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
    });
    const interrupt = () => {
      translator.markInterrupted();
      // Release the relay as well: it may otherwise keep inherited pipes open
      // while the CLI is waiting for a tool response or shutting down.
      host?.close();
      if (interrupted || !running()) return;
      interrupted = true;
      terminate("SIGINT");
      killTimer = setTimeout(() => {
        // taskkill already had the full grace period to terminate the tree.
        // Direct termination is a final fallback if it failed or hung.
        if (running()) child.kill("SIGKILL");
      }, KILL_AFTER_MS);
      killTimer.unref();
    };
    call.abortSignal?.addEventListener("abort", interrupt, { once: true });
    this.options.disposal.addEventListener("abort", interrupt, { once: true });
    // An abort while the tool server was starting fired before these listeners.
    if (call.abortSignal?.aborted || this.options.disposal.aborted) interrupt();
    child.on("error", (error) => settle(() => controller.error(error)));
    // One message, then EOF: the CLI finishes this turn and exits.
    child.stdin.on("error", () => {});
    child.stdin.end(
      `${JSON.stringify({ event: "user", message: { content } })}\n`,
    );

    controller.enqueue({ type: "stream-start", warnings: [] });
    controller.enqueue({
      type: "response-metadata",
      id: generateId(),
      timestamp: new Date(),
      modelId: this.modelId,
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (settled || !line.trim()) return;
      try {
        const event = parseEvent(line);
        if (event) translator.handle(event);
      } catch (error) {
        settle(() => controller.error(error));
        terminate("SIGKILL");
      }
    });
    child.once("exit", () => {
      clearTimeout(killTimer);
      if (process.platform !== "win32") return;
      // `close` waits for every descendant's pipe handle. Give buffered output
      // time to drain, then release our handles even if a descendant escaped.
      closeTimer = setTimeout(() => {
        lines.close();
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        translator.end(stderr.trim());
      }, CLOSE_AFTER_EXIT_MS);
      closeTimer.unref();
    });
    child.on("close", () => {
      clearTimeout(killTimer);
      clearTimeout(closeTimer);
      this.options.disposal.removeEventListener("abort", interrupt);
      lines.close();
      translator.end(stderr.trim());
      closed();
    });
    return {
      stream,
      request: {
        body: {
          model: this.modelId,
          effort,
          conversation: resume,
          content,
        },
      },
    };
  }

  async doGenerate(
    call: LanguageModelV4CallOptions,
  ): Promise<Awaited<ReturnType<LanguageModelV4["doGenerate"]>>> {
    return collectGeneration(await this.doStream(call), this.modelId);
  }
}
