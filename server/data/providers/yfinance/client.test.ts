// Purpose: Verify Yahoo's retry policy and shared chart/search cooldown.
import { Effect } from "effect";
import { expect, test, vi } from "vitest";
import { makeClient } from "./client";

test.each([429, 418])(
  "Yahoo retries status %i at most four times",
  async (status) => {
    const raw = vi.fn(
      async () =>
        new Response(null, { status, headers: { "retry-after": "0" } }),
    );
    const { fetch } = await Effect.runPromise(makeClient(raw));
    expect((await fetch("https://example.test/search")).status).toBe(status);
    expect(raw).toHaveBeenCalledTimes(4);
  },
);

test("cancellation interrupts a cooldown and a shared cooldown gates later requests", async () => {
  const raw = vi.fn(
    async () =>
      new Response(null, { status: 429, headers: { "retry-after": "60" } }),
  );
  const { fetch } = await Effect.runPromise(makeClient(raw));
  const controller = new AbortController();
  const pending = fetch("https://example.test/search", {
    signal: controller.signal,
  });
  const rejection = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(raw).toHaveBeenCalledTimes(1));
  controller.abort();
  await rejection;
  const second = new AbortController();
  const next = fetch("https://example.test/chart", { signal: second.signal });
  const nextRejection = expect(next).rejects.toThrow();
  second.abort();
  await nextRejection;
  expect(raw).toHaveBeenCalledTimes(1);
});
