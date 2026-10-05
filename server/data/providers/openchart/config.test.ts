// Purpose: Verify host-selected Cloud defaults without losing explicit fixture overrides.
import { ConfigProvider, Duration, Effect } from "effect";
import { expect, test } from "vitest";
import { connectionConfig } from "./config";

const read = (baseUrl?: string, settings = {}) =>
  Effect.runPromise(
    connectionConfig(baseUrl).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(settings),
      ),
    ),
  );

test("the host selects sandbox while other hosts retain the production default", async () => {
  expect((await read()).baseUrl.origin).toBe("https://api.alpha.longsurf.ai");
  expect((await read("https://api.sandbox.longsurf.ai")).baseUrl.origin).toBe(
    "https://api.sandbox.longsurf.ai",
  );
});

test("an explicit local fixture and timeout still override host defaults", async () => {
  const config = await read("https://api.sandbox.longsurf.ai", {
    openchart: {
      baseUrl: "http://127.0.0.1:3456",
      requestTimeout: "2 seconds",
    },
  });
  expect(config.baseUrl.origin).toBe("http://127.0.0.1:3456");
  expect(Duration.toMillis(config.requestTimeout)).toBe(2000);
});

test("private DNS does not bypass the existing HTTPS requirement", async () => {
  await expect(
    read("https://api.sandbox.longsurf.ai", {
      openchart: { baseUrl: "http://api.sandbox.longsurf.ai" },
    }),
  ).rejects.toThrow();
});
