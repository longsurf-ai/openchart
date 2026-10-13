// Purpose: Project a compact text preview from a research Session's ordinary Markdown replies.
import type { SessionSnapshot } from "@openchart/app/lib/agent/session-store";

const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });

function plainText(text: string) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/([*`~]|\b_)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads the latest heading-led research reply, falling back to the first
 * sentence of the latest prose reply. Unheaded follow-up chat keeps an earlier
 * research heading. Ignores tool output and nested subagents; empty transcripts
 * return undefined. Leaves the full transcript unchanged and owns no resources.
 * Display truncation belongs to the cell, so sorting retains the full preview.
 *
 * @example latestSemanticAnswer([{ id: "reply", role: "assistant", content: "# 8/10\n\nEvidence…" }])
 */
export function latestSemanticAnswer(
  messages: SessionSnapshot["messages"],
): string | undefined {
  let fallback: string | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (
      message.role !== "assistant" ||
      message.subagentRunId !== undefined ||
      typeof message.content !== "string"
    )
      continue;
    const text = message.content.trim();
    const heading = /^#[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/.exec(
      text.split(/\r?\n/, 1)[0] ?? "",
    );
    if (heading) {
      const value = plainText(heading[1]!);
      if (value) return value;
    }
    if (fallback) continue;
    // Fenced examples and section headings are not prose previews.
    const paragraph = text
      .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[\t ]*$/gm, "")
      .split(/\r?\n\s*\r?\n/)
      .find(
        (part) =>
          part.trim() && !/^\s*(?:#{1,6}(?:\s|$)|`{3,}|~{3,})/.test(part),
      );
    if (paragraph) {
      const first = sentences
        .segment(plainText(paragraph))
        [Symbol.iterator]()
        .next();
      fallback = first.value?.segment.trim() || undefined;
    }
  }
  return fallback;
}
