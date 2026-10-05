// Purpose: Exercise the actual IPC wire boundary with structured and invalid payloads.
import { expect, test } from "vitest";
import { Encoding, Schema } from "effect";
import { tableToIPC } from "apache-arrow";
import { createDataFrame } from "./dataFrame";
import { dataFrameCodec, parseJson, toJson } from "./json";
import { fromPoints } from "./fromPoints";
import { structuredRows, structuredTable } from "./testFrames";

test("shared Effect envelope codec preserves nested output, metadata, null and NaN", () => {
  const source = createDataFrame(structuredTable(), {
    labels: { symbol: "AAPL" },
  });
  const envelope = Schema.Struct({ data: dataFrameCodec });
  const wire = Schema.encodeSync(envelope)({ data: source });
  expect(typeof wire.data).toBe("string");
  const { data } = Schema.decodeUnknownSync(envelope)(
    JSON.parse(JSON.stringify(wire)),
  );
  expect(Array.from(data)).toEqual(structuredRows);
  expect(data.labels).toEqual(source.labels);
  expect(data.schema.fields[2]!.metadata.get("tea:write")).toBe("append");
  expect(data.get(0)!.value).toBeNull();
  expect(data.get(1)!.value).toBeNaN();
});

test("empty and explicit event frames roundtrip without erasing schema or event order", () => {
  const empty = createDataFrame(structuredTable([]));
  const result = parseJson(toJson(empty));
  expect(result.numRows).toBe(0);
  expect(result.schema.fields[2]!.metadata.get("tea:write")).toBe("append");
  const events = fromPoints(
    {},
    [
      { time: 1, text: "a" },
      { time: 1, text: "b" },
    ],
    { allowDuplicateTimes: true },
  );
  expect(Array.from(parseJson(toJson(events)))).toEqual(Array.from(events));
});

test("malformed base64, IPC, timeline and legacy JSON payloads fail at the boundary", () => {
  for (const wire of ["", "not base64", "AAAA", { time: [1], fields: {} }])
    expect(() => Schema.decodeUnknownSync(dataFrameCodec)(wire)).toThrow();
  const invalid = structuredTable([
    { time: 20, value: 1, events: [] },
    { time: 10, value: 2, events: [] },
  ]);
  expect(() => parseJson(Encoding.encodeBase64(tableToIPC(invalid)))).toThrow(
    "strictly ascending",
  );
  const bytes = tableToIPC(structuredTable());
  expect(() =>
    parseJson(
      Encoding.encodeBase64(bytes.slice(0, Math.floor(bytes.length / 2))),
    ),
  ).toThrow();
});
