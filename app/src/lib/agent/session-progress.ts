// Purpose: Derive consumer-independent progress from the shared Session snapshot.
import type { SessionSnapshot } from "@openchart/app/lib/agent/session-store";

/** Active Run progress with epoch-millisecond time and untruncated current-turn lines. */
export type SessionProgress = {
  status: "queued" | "running";
  startedAt: number;
  lines: string[];
};

/**
 * Derives active Run progress from a Session snapshot without mutating it.
 * Unobserved state and terminal Runs return undefined. Consumers own
 * subscriptions, line limits and display clocks.
 * @example const progress = selectSessionProgress(snapshot);
 */
export function selectSessionProgress(
  snapshot: SessionSnapshot,
): SessionProgress | undefined {
  const run =
    snapshot.state?.runs.find((run) => run.status === "running") ??
    snapshot.state?.runs.find((run) => run.status === "queued");
  if (!run) return undefined;
  const latestUser = snapshot.messages
    .map((message) => message.role)
    .lastIndexOf("user");
  const lines = snapshot.messages.slice(latestUser + 1).flatMap((message) => {
    if (message.role !== "assistant" && message.role !== "reasoning") return [];
    if (message.metadata?.openchart?.createdAt < run.createdAt) return [];
    const text = typeof message.content === "string" ? message.content : "";
    const tools =
      message.role === "assistant"
        ? (message.toolCalls?.map((call) => `Using ${call.function.name}…`) ??
          [])
        : [];
    return [
      ...text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      ...tools,
    ];
  });
  return {
    status: run.status === "queued" ? "queued" : "running",
    startedAt: run.startedAt ?? run.createdAt,
    lines,
  };
}
