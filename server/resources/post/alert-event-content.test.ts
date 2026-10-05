// Purpose: Prevents generic Rule Posts from losing saved subjects/values or inventing them from bindings.
import { Schema } from "effect";
import { expect, test } from "vitest";
import { AlertEventEntity } from "@openchart/server/resources/alert-event";
import { alertEventPostContent } from "./alert-event-content";

const event = (
  data: Schema.JsonObject,
  title = "Volume",
  message = "Threshold met",
) =>
  Schema.decodeUnknownSync(AlertEventEntity)({
    id: "ale_source",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    ruleId: "alr_source",
    condition: "alert",
    time: 1,
    detail: { title, message, data },
  });

test("retains the explicit subject and value, with direct scalars winning over nested values", () => {
  for (const value of [21.79, 21.69, 0, false, "21.79"] as const) {
    expect(
      alertEventPostContent(
        event({
          symbol: "AAPL",
          value,
          values: { value: 999 },
          parameters: { threshold: 10 },
        }),
      ),
    ).toEqual([
      {
        type: "text",
        text: `AAPL · Value: ${value}\n\nVolume\n\nThreshold met`,
      },
    ]);
  }
  expect(
    alertEventPostContent(event({ symbol: "AAPL", values: { value: 21.69 } })),
  ).toEqual([
    {
      type: "text",
      text: "AAPL · Value: 21.69\n\nVolume\n\nThreshold met",
    },
  ]);
});

test("never infers facts from inputs/config or renders object values/raw JSON", () => {
  expect(
    alertEventPostContent(
      event({
        value: { value: 42 },
        values: { value: [1, 2] },
        inputs: { listing: { symbol: "WRONG" } },
        parameters: { value: 55, symbol: "WRONG" },
      }),
    ),
  ).toEqual([{ type: "text", text: "Volume\n\nThreshold met" }]);
  expect(alertEventPostContent(event({ value: 0 }, " ", ""))).toEqual([
    { type: "text", text: "Value: 0\n\nalert" },
  ]);
  expect(
    alertEventPostContent({ ...event({}, "", ""), condition: " " }),
  ).toEqual([{ type: "text", text: "Alert triggered" }]);
});

test("keeps exactly 350 code points and truncates longer source text without splitting emoji", () => {
  for (const character of ["a", "€", "😀"]) {
    expect(alertEventPostContent(event({}, "", character.repeat(350)))).toEqual(
      [{ type: "text", text: character.repeat(350) }],
    );
    expect(alertEventPostContent(event({}, "", character.repeat(351)))).toEqual(
      [{ type: "text", text: `${character.repeat(349)}…` }],
    );
  }
  expect(
    alertEventPostContent({ ...event({}, "", ""), condition: "a".repeat(351) }),
  ).toEqual([{ type: "text", text: `${"a".repeat(349)}…` }]);
});
