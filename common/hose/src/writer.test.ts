// Purpose: Locks Hose fair dispatch, byte bounds, backpressure, cancellation, and send failure.

import { expect, test } from "vitest";

import { HoseWriter } from "./writer";

function socket() {
  const sent: string[] = [];
  const closed: Array<[number | undefined, string | undefined]> = [];
  let bufferedAmount = 0;
  let block = false;
  return {
    sent,
    closed,
    setBuffered(value: number) {
      bufferedAmount = value;
    },
    block() {
      block = true;
    },
    socket: {
      send(msg: string) {
        sent.push(msg);
        if (block) {
          bufferedAmount = 1;
          block = false;
        }
        return true;
      },
      get bufferedAmount() {
        return bufferedAmount;
      },
      close(code?: number, reason?: string) {
        closed.push([code, reason]);
      },
    },
  };
}

test("moves to the next lane after backpressure", () => {
  const mock = socket();
  const writer = new HoseWriter(mock.socket, () => {});
  mock.block();
  writer.send("large", "large-1");
  writer.send("large", "large-2");
  writer.send("small", "small-1");
  expect(mock.sent).toEqual(["large-1"]);
  mock.setBuffered(0);
  writer.drain();
  expect(mock.sent).toEqual(["large-1", "small-1", "large-2"]);
  writer.dispose();
});

test("closes a slow client when queued bytes exceed the limit", () => {
  const mock = socket();
  const failed: string[] = [];
  mock.setBuffered(1);
  const writer = new HoseWriter(
    mock.socket,
    (failure) => failed.push(failure),
    8,
  );
  writer.send("one", "1234");
  writer.send("two", "123456789");
  expect(failed).toEqual(["slow_client"]);
  expect(mock.closed).toEqual([[1013, "slow_client"]]);
});

test("cancel removes queued messages for one lane", () => {
  const mock = socket();
  mock.setBuffered(1);
  const writer = new HoseWriter(mock.socket, () => {});
  writer.send("one", "first");
  writer.send("one", "second");
  writer.send("two", "other");
  writer.cancel("one");
  mock.setBuffered(0);
  writer.drain();
  expect(mock.sent).toEqual(["other"]);
  writer.dispose();
});

test("send failure closes the socket once", () => {
  const closed: number[] = [];
  const failed: string[] = [];
  const writer = new HoseWriter(
    {
      send() {
        throw new Error("closed");
      },
      bufferedAmount: 0,
      close(code) {
        if (code) closed.push(code);
      },
    },
    (failure) => failed.push(failure),
  );
  writer.send("one", "message");
  expect(failed).toEqual(["send_failed"]);
  expect(closed).toEqual([1013]);
  expect(writer.send("one", "again")).toBe(false);
});

test("closes when the socket drops a message", () => {
  const failed: string[] = [];
  const closed: number[] = [];
  const writer = new HoseWriter(
    {
      send: () => false,
      bufferedAmount: 0,
      close: (code) => {
        if (code) closed.push(code);
      },
    },
    (failure) => {
      failed.push(failure);
      throw new Error("failure callback");
    },
  );
  expect(() => writer.send("one", "message")).toThrow("failure callback");
  expect(failed).toEqual(["send_failed"]);
  expect(closed).toEqual([1013]);
});
