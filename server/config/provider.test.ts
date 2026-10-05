// Purpose: Verify file-backed config reloads, failure recovery, and domain validation.

import {
  Config,
  ConfigProvider,
  Duration,
  Effect,
  Layer,
  ManagedRuntime,
} from "effect";
import { Events } from "@openchart/server/events";
import { connectionConfig } from "@openchart/server/data/providers/openchart/config";
import { config as binance } from "@openchart/server/data/providers/binance/config";
import { config as yfinance } from "@openchart/server/data/providers/yfinance/config";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

import { ConfigFile, layerFromFile } from "./provider";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));

const openchart = connectionConfig();

function configured(text?: string) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => fs.mkdtemp(join(tmpdir(), "openchart-config-"))),
        (directory) =>
          Effect.promise(() =>
            fs.rm(directory, { recursive: true, force: true }),
          ),
      );
      const filename = join(directory, "settings.json");
      if (text !== undefined)
        yield* Effect.promise(() => fs.writeFile(filename, text));
      return layerFromFile(filename).pipe(Layer.provide(Events.layer));
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("an absent file permits defaults without reading process environment", async () => {
  vi.stubEnv("TEST_CONFIG", "environment-value");
  expect(
    await Effect.runPromise(
      Config.string("TEST_CONFIG").pipe(
        Config.withDefault("declared-default"),
        Effect.provide(configured()),
      ),
    ),
  ).toBe("declared-default");
  await expect(
    Effect.runPromise(openchart.pipe(Effect.provide(configured()))).then(
      (value) => value.baseUrl.href,
    ),
  ).resolves.toBe("https://api.alpha.longsurf.ai/");
});

test("independent recipes consume one nested config file and preserve empty strings", async () => {
  const fixture = Config.all({
    enabled: Config.boolean("enabled"),
    name: Config.string("name"),
  }).pipe(Config.nested("fixture"));
  const result = await Effect.runPromise(
    Config.all({ openchart, fixture }).pipe(
      Effect.provide(
        configured(
          JSON.stringify({
            openchart: {
              baseUrl: "https://openchart.example.com",
              requestTimeout: "2 seconds",
            },
            fixture: { enabled: true, name: "" },
          }),
        ),
      ),
    ),
  );
  expect(result.openchart.baseUrl.href).toBe("https://openchart.example.com/");
  expect(Duration.toMillis(result.openchart.requestTimeout)).toBe(2000);
  expect(result.fixture).toEqual({ enabled: true, name: "" });
});

test.each([
  { id: "binance", recipe: binance },
  { id: "yfinance", recipe: yfinance },
])(
  "$id native config defaults only missing values, never malformed fields or namespaces",
  async ({ id, recipe }) => {
    for (const document of [
      undefined,
      {},
      { providers: {} },
      { providers: { [id]: {} } },
    ]) {
      await expect(
        Effect.runPromise(
          recipe.pipe(Effect.provide(configured(JSON.stringify(document)))),
        ),
      ).resolves.toBe(true);
    }
    await expect(
      Effect.runPromise(
        recipe.pipe(
          Effect.provide(
            configured(
              JSON.stringify({ providers: { [id]: { enabled: false } } }),
            ),
          ),
        ),
      ),
    ).resolves.toBe(false);
    for (const document of [
      ...["invalid", 42, {}].map((enabled) => ({
        providers: { [id]: { enabled } },
      })),
      { providers: { [id]: 42 } },
      { providers: 42 },
    ]) {
      await expect(
        Effect.runPromise(
          recipe.pipe(Effect.provide(configured(JSON.stringify(document)))),
        ),
        JSON.stringify(document),
      ).rejects.toBeDefined();
    }
  },
);

test.each([
  "",
  "{",
  "[]",
  "null",
  '{"openchart":null}',
  '{"openchart":{"requestTimeout":null}}',
])(
  "rejects malformed startup config instead of treating it as missing: %s",
  async (text) => {
    await expect(
      Effect.runPromise(
        ConfigProvider.ConfigProvider.pipe(Effect.provide(configured(text))),
      ),
    ).rejects.toBeDefined();
  },
);

test.each(["0 seconds", "-1 second", "Infinity", "", "not-a-duration"])(
  "rejects invalid timeout rather than selecting a default: %s",
  async (requestTimeout) => {
    await expect(
      Effect.runPromise(
        openchart.pipe(
          Effect.provide(
            configured(
              JSON.stringify({
                openchart: {
                  baseUrl: "https://openchart.example.com",
                  requestTimeout,
                },
              }),
            ),
          ),
        ),
      ),
    ).rejects.toBeDefined();
  },
);

test.each([
  "file:///etc/passwd",
  "http://openchart.example.com",
  "invalid",
  "",
  "https://user:password@openchart.example.com",
  "https://openchart.example.com?token=secret",
  "https://openchart.example.com#fragment",
])("rejects an invalid OpenChart endpoint: %s", async (baseUrl) => {
  await expect(
    Effect.runPromise(
      openchart.pipe(
        Effect.provide(configured(JSON.stringify({ openchart: { baseUrl } }))),
      ),
    ),
  ).rejects.toBeDefined();
});

test("accepts HTTP loopback and the timeout default", async () => {
  const value = await Effect.runPromise(
    openchart.pipe(
      Effect.provide(
        configured('{"openchart":{"baseUrl":"http://127.0.0.1:3000"}}'),
      ),
    ),
  );
  expect(value.baseUrl.port).toBe("3000");
  expect(Duration.toMillis(value.requestTimeout)).toBe(30_000);
});

test("monitors creation, atomic replacement, invalid content, recovery, and removal", async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), "openchart-config-"));
  const filename = join(directory, "profile", "settings.json");
  const runtime = ManagedRuntime.make(
    layerFromFile(filename).pipe(Layer.provide(Events.layer)),
  );
  const name = Config.string("name").pipe(Config.withDefault("missing"));
  try {
    expect(await runtime.runPromise(name)).toBe("missing");
    await expect(fs.stat(join(directory, "profile"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await fs.mkdir(join(directory, "profile"));
    await fs.writeFile(filename, '{"name":"first"}');
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(name)).toBe("first"),
    );
    const staging = join(directory, "profile", "next.json");
    await fs.writeFile(staging, '{"name":"second"}');
    await fs.rename(staging, filename);
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(name)).toBe("second"),
    );
    await fs.writeFile(filename, "{");
    await vi.waitFor(async () => {
      await expect(runtime.runPromise(name)).rejects.toBeDefined();
      await expect(
        runtime.runPromise(ConfigFile.use((file) => file.read)),
      ).rejects.toBeDefined();
    });
    await fs.writeFile(filename, '{"name":"recovered"}');
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(name)).toBe("recovered"),
    );
    await fs.unlink(filename);
    await vi.waitFor(async () =>
      expect(await runtime.runPromise(name)).toBe("missing"),
    );
  } finally {
    await runtime.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("stops reading the file when the owning runtime is disposed", async () => {
  const reads = vi.spyOn(fs, "readFile");
  const runtime = ManagedRuntime.make(configured("{}"));
  await runtime.runPromise(ConfigProvider.ConfigProvider);
  await runtime.dispose();
  const count = reads.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(reads).toHaveBeenCalledTimes(count);
});

test("storage failures remain failures", async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), "openchart-config-error-"));
  try {
    await expect(
      Effect.runPromise(
        ConfigProvider.ConfigProvider.pipe(
          Effect.provide(
            layerFromFile(directory).pipe(Layer.provide(Events.layer)),
          ),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "ConfigReadFailed" });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a failed atomic replacement preserves the file and removes the temporary write", async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), "openchart-config-write-"));
  const filename = join(directory, "settings.json");
  await fs.writeFile(filename, '{"name":"before"}');
  const runtime = ManagedRuntime.make(
    layerFromFile(filename).pipe(Layer.provide(Events.layer)),
  );
  try {
    await runtime.context();
    vi.spyOn(fs, "rename").mockRejectedValueOnce(
      new Error("rename unavailable"),
    );
    await expect(
      runtime.runPromise(
        ConfigFile.use((file) =>
          file.update({ name: "after" }, () => Effect.void),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "ConfigWriteFailed" });
    expect(await fs.readFile(filename, "utf8")).toBe('{"name":"before"}');
    expect(await runtime.runPromise(Config.string("name"))).toBe("before");
    expect(await fs.readdir(directory)).toEqual(["settings.json"]);
  } finally {
    await runtime.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
