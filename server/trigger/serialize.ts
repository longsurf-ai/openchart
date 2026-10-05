// Purpose: Renders Trigger text from explicit source-event tokens without changing prompt structure.

import type { AgentPromptInput } from "@openchart/server/agent/contracts/agent-prompt-input";
import type { AlertEvent } from "@openchart/server/resources/alert-event";
import { Predicate } from "effect";

/** Token values of one source event, looked up by the name inside "{...}". */
export type Tokens = ReadonlyMap<string, string>;

/**
 * Replaces known `{token}` names; unknown tokens stay literal. A backslash
 * escapes a brace or another backslash. Replacement values are never rendered
 * again, so source text cannot introduce another substitution. Pure.
 * @example
 * renderTemplate("{symbol} crossed {threshold}", tokens); // "AAPL crossed 200"
 */
export function renderTemplate(template: string, tokens: Tokens): string {
  return template.replace(
    /\\([\\{}])|\{(\w+)\}/g,
    (placeholder, literal: string | undefined, token: string | undefined) =>
      literal ?? tokens.get(token!) ?? placeholder,
  );
}

/**
 * Renders only text parts. Attachments, file references, model, workspace,
 * and every other prompt field retain their original values. Pure.
 * @example
 * const input = renderPrompt(target.prompt, alertTokens(event, rule.name));
 */
export function renderPrompt(
  prompt: AgentPromptInput,
  tokens: Tokens,
): AgentPromptInput {
  return {
    ...prompt,
    parts: prompt.parts.map((part) =>
      part.type === "text"
        ? { ...part, text: renderTemplate(part.text, tokens) }
        : part,
    ),
  };
}

function scalarEntries(value: unknown): [string, string][] {
  return Predicate.isObject(value)
    ? Object.entries(value).flatMap(([key, value]) =>
        typeof value === "string" ||
        typeof value === "boolean" ||
        typeof value === "number"
          ? [[key, String(value)] as [string, string]]
          : [],
      )
    : [];
}

/**
 * Builds tokens with fixed rule/condition/time/title/message fields winning
 * over explicit scalar data fields, then data.parameters, then data.values.
 * Source adapters own identity: this consumer never infers a symbol from
 * inputs. Nested objects, arrays and null are not tokens. Pure.
 * @example
 * const body = renderTemplate(target.message, alertTokens(event, rule.name));
 */
export function alertTokens(event: AlertEvent, ruleName: string): Tokens {
  const { title, message, data } = event.detail;
  return new Map([
    ...scalarEntries(data.values),
    ...scalarEntries(data.parameters),
    ...scalarEntries(data),
    ["rule", ruleName],
    ["condition", event.condition],
    ["time", new Date(event.time).toISOString()],
    ["title", title],
    ["message", message],
  ]);
}
