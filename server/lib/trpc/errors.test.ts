// Purpose: Verify shared error policy across ordinary HTTP routes, late SSE failures, and Hose operations.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { Schema } from "effect";

import { once } from "node:events";
import { createServer } from "node:http";
import { FeedReasons } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { feedError } from "@openchart/server/feed/errors";
import * as Tea from "@openchart/tea";
import { makeRuntime } from "@openchart/server/runtime";
import { streamChannel } from "@openchart/server/lib/hose";
import { ResourceStateInvalid } from "@openchart/server/lib/resource/errors";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { ConfigProvider, Effect, Stream } from "effect";
import { expect, test, vi } from "vitest";
import { z } from "zod";

import { trpc } from "./trpc";

const provider = ProviderId.make("yfinance");

test("applies one public policy to any HTTP route, input failure, and late subscription error", async () => {
  const secret = new Error("private database connection details");
  let cause: Error = secret;
  const router = trpc.router({
    operation: trpc.procedure.input(z.object({ key: z.string() })).query(() => {
      throw cause;
    }),
    late: trpc.procedure.subscription(async function* () {
      yield "connected";
      throw cause;
    }),
  });
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  const server = createServer(
    createHTTPHandler({
      router,
      createContext: () => ({ runtime }),
    }),
  );
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No server port");
    const base = `http://127.0.0.1:${address.port}`;
    const input = encodeURIComponent(JSON.stringify({ key: "x" }));
    // A public Feed failure crosses as its encoded schema value, never its cause.
    cause = feedError(new FeedReasons.NotFound({ provider }), secret);
    const feed = await fetch(`${base}/operation?input=${input}`);
    expect(feed.status).toBe(404);
    const feedBody = await feed.text();
    expect(JSON.parse(feedBody).error).toMatchObject({
      message: "Yahoo Finance doesn't have this symbol.",
      data: { code: "NOT_FOUND" },
    });
    expect(JSON.parse(feedBody).error.data.error).toEqual({
      _tag: "FeedError",
      reason: { _tag: "Feed.NotFound", provider },
    });
    expect(feedBody).not.toContain(secret.message);
    expect(feedBody).not.toContain('"cause"');
    for (const expected of [
      {
        cause: new Tea.Error(
          { code: "compile_failed", message: "Tea source did not compile" },
          { cause: secret },
        ),
        status: 400,
        // A Tea failure travels in the same public slot as Feed: data.error.
        text: '"error":{"code":"compile_failed","message":"Tea source did not compile"}',
      },
      {
        cause: new Tea.Error({
          code: "node_unavailable",
          message: "Tea node is unavailable",
        }),
        status: 404,
        text: '"error":{"code":"node_unavailable","message":"Tea node is unavailable"}',
      },
      {
        cause: new ResourceStateInvalid({
          resource: "example",
          reason: "Invalid name",
          issues: [],
        }),
        status: 400,
        text: "resourceStateInvalid",
      },
      { cause: secret, status: 500, text: "Internal server error" },
    ]) {
      cause = expected.cause;
      const response = await fetch(`${base}/operation?input=${input}`);
      expect(response.status).toBe(expected.status);
      const body = await response.text();
      expect(body).toContain(expected.text);
      expect(body).not.toContain(secret.message);
      expect(body).not.toContain('"stack"');
      expect(body).not.toContain('"cause"');
    }
    const invalid = await fetch(`${base}/operation?input=%7B%7D`);
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain("Invalid request");
    const missing = await fetch(`${base}/missing`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain('"stack"');

    // A subscription succeeds initially; its later failure bypasses unary middleware.
    const stream = await fetch(`${base}/late`);
    expect(stream.status).toBe(200);
    const events = await stream.text();
    expect(events).toContain("connected");
    expect(events).toContain("Internal server error");
    expect(events).not.toContain(secret.message);
    expect(events).not.toContain('"stack"');
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith("Server request failed", secret);
  } finally {
    logged.mockRestore();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await runtime.dispose();
  }
});

test("Hose centralizes parsing, source and encoding failures, and cancellation", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
    config: ConfigProvider.fromUnknown({}),
  });
  const stopped = vi.fn();
  const upstream = new Error("private upstream response");
  const channel = () => ({
    id: "one",
    data: vi.fn(),
    error: vi.fn(),
    done: vi.fn(),
    onData: vi.fn(),
  });
  const handler = streamChannel(
    { parse: Schema.decodeUnknownSync(Schema.String) },
    (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (input === "fail")
            return yield* Effect.fail(
              feedError(
                new FeedReasons.SourceUnavailable({ provider }),
                upstream,
              ),
            );
          yield* Effect.addFinalizer(() => Effect.sync(stopped));
          return input === "late"
            ? Stream.fail(feedError(new FeedReasons.AccessDenied({ provider })))
            : Stream.concat(Stream.succeed({ value: 1 }), Stream.never);
        }),
      ),
  );
  try {
    await runtime.context();
    const invalid = channel();
    handler(42, invalid, { runtime });
    await vi.waitFor(() =>
      expect(invalid.error).toHaveBeenCalledWith("invalid_request"),
    );
    const failed = channel();
    handler("fail", failed, { runtime });
    await vi.waitFor(() =>
      expect(failed.error).toHaveBeenCalledWith("failed", {
        _tag: "FeedError",
        reason: { _tag: "Feed.SourceUnavailable", provider },
      }),
    );
    // The body is the encoded public error only; the upstream cause stays local.
    expect(JSON.stringify(failed.error.mock.calls)).not.toContain(
      upstream.message,
    );
    const cancelled = channel();
    const stop = handler("ok", cancelled, { runtime });
    await vi.waitFor(() => expect(cancelled.data).toHaveBeenCalledOnce());
    stop?.();
    stop?.();
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(1));
    expect(cancelled.error).not.toHaveBeenCalled();
    expect(cancelled.done).not.toHaveBeenCalled();
    const encoded = channel();
    const secret = new Error("private encoder details");
    encoded.data.mockImplementation(() => {
      throw secret;
    });
    handler("ok", encoded, { runtime });
    await vi.waitFor(() =>
      expect(encoded.error).toHaveBeenCalledWith("internal"),
    );
    expect(logged).toHaveBeenCalledWith("Server request failed", secret);
    const live = channel();
    handler("late", live, { runtime });
    await vi.waitFor(() =>
      expect(live.error).toHaveBeenCalledWith("failed", {
        _tag: "FeedError",
        reason: { _tag: "Feed.AccessDenied", provider },
      }),
    );
    expect(stopped).toHaveBeenCalledTimes(3);
  } finally {
    await runtime.dispose();
    logged.mockRestore();
  }
});
