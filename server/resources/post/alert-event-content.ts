// Purpose: Keeps Rule Posts identifiable using explicit facts saved with their source Event.
import type { AlertEvent } from "@openchart/server/resources/alert-event";
import { Predicate } from "effect";
import type { PostText } from "./schema";
import { POST_CHARACTER_LIMIT } from "./entity";

/**
 * Prefixes source-authored text with its saved symbol and scalar value. Explicit
 * data.value wins over data.values.value; input bindings and current Rule
 * configuration never supply identity or values. Caps the Post at 350 Unicode code
 * points, including a trailing ellipsis when truncated; the Event stays complete.
 * Pure; missing facts stay absent.
 * @example const content = alertEventPostContent(event);
 */
export function alertEventPostContent(
  event: AlertEvent,
): readonly (typeof PostText.Type)[] {
  const { title, message, data } = event.detail;
  const symbol = Predicate.isString(data.symbol) ? data.symbol.trim() : "";
  const value = [
    data.value,
    Predicate.isObject(data.values) ? data.values.value : undefined,
  ].find(
    (candidate) =>
      Predicate.isString(candidate) ||
      Predicate.isNumber(candidate) ||
      Predicate.isBoolean(candidate),
  );
  const facts = [symbol, value === undefined ? "" : `Value: ${String(value)}`]
    .filter(Boolean)
    .join(" · ");
  const body =
    [title, message].filter((text) => /\S/.test(text)).join("\n\n") ||
    event.condition.trim() ||
    "Alert triggered";
  const characters = Array.from([facts, body].filter(Boolean).join("\n\n"));
  return [
    {
      type: "text",
      text:
        characters.length > POST_CHARACTER_LIMIT
          ? `${characters.slice(0, POST_CHARACTER_LIMIT - 1).join("")}…`
          : characters.join(""),
    },
  ];
}
