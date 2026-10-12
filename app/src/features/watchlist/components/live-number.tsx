// Purpose: Colour the digits changed since the previous displayed live value.
import { useState } from "react";

const decimal = new Intl.NumberFormat()
  .formatToParts(1.1)
  .find((part) => part.type === "decimal")!.value;
const digit = /\p{Nd}/u;

// Identify digits by decimal place, ignoring grouping and signs.
function digits(text: string) {
  let place = [...text.split(decimal)[0]!].filter((char) =>
    digit.test(char),
  ).length;
  return [...text].map((char) =>
    digit.test(char) ? `${--place}:${char}` : undefined,
  );
}

/**
 * Render a finite value's locale-formatted decimal text. Changed digits retain
 * their up/down colour until the next displayed change; the first value is plain.
 * Remount for a new series/output or after missing/historical data. This component
 * owns only display state, with no effects, timers, subscriptions or I/O failures.
 * @example <LiveNumber value={42.15} text="42.15" />
 */
export function LiveNumber({ value, text }: { value: number; text: string }) {
  const [last, setLast] = useState({ value, text, from: text, up: false });
  if (text !== last.text)
    setLast({ value, text, from: last.text, up: value > last.value });
  if (last.from === last.text) return text;
  const before = new Set(digits(last.from));
  const after = digits(text);
  const tone = last.up ? "text-up" : "text-down";
  return [...text].map((char, index) =>
    after[index] && !before.has(after[index]) ? (
      <span key={index} className={tone}>
        {char}
      </span>
    ) : (
      char
    ),
  );
}
