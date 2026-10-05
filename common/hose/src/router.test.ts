// Purpose: Lock routing, context injection, composition, and teardown ownership.

import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { Channel } from "./connection";
import { HoseRouter, type ChannelHandler } from "./router";

function channel(): Channel {
  return {
    id: "test",
    data: vi.fn(),
    done: vi.fn(),
    error: vi.fn(),
    onData: vi.fn(),
  };
}

it("dispatches independent schemas with the original body, context, and teardown", () => {
  const Text = z.object({ type: z.literal("text"), text: z.string() }).strict();
  const Count = z
    .object({ type: z.literal("count"), count: z.number() })
    .strict();
  const teardown = vi.fn();
  const text = vi.fn<ChannelHandler<{ name: string }>>((body, output, ctx) => {
    output.data(ctx.name + Text.parse(body).text);
    return teardown;
  });
  const router = new HoseRouter<{ name: string }>()
    .route("text", text)
    .route("count", (body, output) => {
      output.data(Count.parse(body).count);
      output.done();
    });
  const body = { type: "text", text: "hello" };
  const ctx = { name: "first" };
  const first = channel();
  expect(router.handle(body, first, ctx)).toBe(teardown);
  expect(text.mock.calls[0]?.[0]).toBe(body);
  expect(text.mock.calls[0]?.[2]).toBe(ctx);
  expect(first.data).toHaveBeenCalledWith("firsthello");
  expect(teardown).not.toHaveBeenCalled();
  const second = channel();
  router.handle(body, second, { name: "second" });
  expect(second.data).toHaveBeenCalledWith("secondhello");
  const count = channel();
  router.handle({ type: "count", count: 7 }, count, ctx);
  expect(count.data).toHaveBeenCalledWith(7);
  expect(count.done).toHaveBeenCalledOnce();
});

it("rejects malformed and unknown operations without invoking a handler", () => {
  const handler = vi.fn<ChannelHandler>();
  const router = new HoseRouter().route("known", handler);
  for (const body of [null, [], {}, "known", { type: "" }, { type: 1 }]) {
    const output = channel();
    router.handle(body, output, undefined);
    expect(output.error).toHaveBeenCalledWith("invalid_request");
  }
  for (const type of ["missing", "toString", "constructor", "__proto__"]) {
    const output = channel();
    router.handle({ type }, output, undefined);
    expect(output.error).toHaveBeenCalledWith("not_found");
  }
  expect(handler).not.toHaveBeenCalled();
});

it("composes routers without modifying sources or replacing existing routes", () => {
  const handler = vi.fn<ChannelHandler>();
  const source = new HoseRouter().route("known", handler);
  const router = new HoseRouter(source).route("extra", handler);
  source.route("later", handler);
  const output = channel();
  router.handle({ type: "later" }, output, undefined);
  source.handle({ type: "extra" }, output, undefined);
  expect(output.error).toHaveBeenCalledTimes(2);
  expect(() => new HoseRouter(source, source)).toThrow(
    "Duplicate channel operation known",
  );
  expect(() => router.route("known", handler)).toThrow(
    "Duplicate channel operation known",
  );
  expect(() => router.route("", handler)).toThrow("must not be empty");
  router.handle({ type: "known" }, channel(), undefined);
  expect(handler).toHaveBeenCalledOnce();
});
