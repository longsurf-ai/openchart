// Purpose: Locks required Hose envelope fields at the wire boundary.

import { expect, test } from "vitest";

import { ClientMsg, ServerMsg } from "./protocol";

test("requires bodies on open and data messages", () => {
  expect(ClientMsg.safeParse({ type: "open", id: "a" }).success).toBe(false);
  expect(ServerMsg.safeParse({ type: "data", id: "a" }).success).toBe(false);
});

test("clients may send data with the server's strict DataMsg shape", () => {
  const data = { type: "data", id: "a", body: { jsonrpc: "2.0" } };
  expect(ClientMsg.parse(data)).toEqual(data);
  expect(ClientMsg.safeParse({ type: "data", id: "a" }).success).toBe(false);
  expect(ClientMsg.safeParse({ ...data, extra: true }).success).toBe(false);
  expect(ClientMsg.safeParse({ type: "done", id: "a" }).success).toBe(false);
});

test("errors carry an owner body for failed and nothing for a Hose code", () => {
  const failed = {
    type: "error",
    id: "a",
    code: "failed",
    body: { _tag: "X" },
  };
  expect(ServerMsg.parse(failed)).toEqual(failed);
  const notFound = { type: "error", id: "a", code: "not_found" };
  expect(ServerMsg.parse(notFound)).toEqual(notFound);
  for (const invalid of [
    { type: "error", id: "a", code: "failed" },
    { ...notFound, body: { _tag: "X" } },
    { ...failed, message: "Failed" },
    { ...notFound, message: "not found" },
    { type: "error", id: "a", code: "open_failed" },
  ]) {
    expect(ServerMsg.safeParse(invalid).success).toBe(false);
  }
});
