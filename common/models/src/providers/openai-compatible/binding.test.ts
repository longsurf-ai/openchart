// Purpose: Verifies OpenAI-compatible discovery, configuration gates, and model projection.
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, test } from "vitest";
import { OPENAI_COMPATIBLE } from "@openchart/models/model-tiers";
import type { ModelsDev } from "@openchart/models/catalog";
import { openaiCompatible } from "./binding";

const servers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of servers.splice(0).reverse()) await close();
});

async function endpoint(
  rows: Array<{ id: string }>,
  inspect?: (authorization: string | undefined) => void,
) {
  const server = createServer((request, response) => {
    inspect?.(request.headers.authorization);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: rows }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  servers.push(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return `http://127.0.0.1:${address.port}/v1`;
}

const catalog: ModelsDev.Catalog = {
  async get() {
    return {
      openai: {
        models: {
          "model-a": {
            attachment: false,
            reasoning: true,
            temperature: true,
            tool_call: true,
            limit: { context: 1_000_000, output: 16_384 },
          },
        },
      },
    };
  },
};

test("requires a base URL", async () => {
  const binding = openaiCompatible.createModelProvider(catalog, {
    baseURL: "",
  });
  expect(await binding.discover()).toEqual({
    status: "configuration_required",
    message: "Set an OpenAI-compatible base URL.",
  });
  const invalidURL = openaiCompatible.createModelProvider(catalog, {
    baseURL: "not a url",
  });
  expect(await invalidURL.discover()).toEqual({
    status: "configuration_required",
    message: "Set a valid http(s) OpenAI-compatible base URL.",
  });
});

test("returns discovered models directly", async () => {
  const baseURL = await endpoint([{ id: "local-model" }]);
  const binding = openaiCompatible.createModelProvider(catalog, { baseURL });
  const result = await binding.discover();
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(result.provider.models.map((model) => model.id)).toEqual([
    "local-model",
  ]);
  await binding.dispose();
});

test("discovers models, sends the key, and enriches metadata", async () => {
  const baseURL = await endpoint(
    [{ id: "model-a" }, { id: "model-b" }],
    (authorization) => expect(authorization).toBe("Bearer secret"),
  );
  const binding = openaiCompatible.createModelProvider(catalog, {
    baseURL,
    apiKey: "secret",
    catalogProvider: "openai",
  });
  const result = await binding.discover();
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(result.provider.id).toBe(OPENAI_COMPATIBLE);
  expect(result.provider.models.map((model) => model.id)).toEqual([
    "model-a",
    "model-b",
  ]);
  expect(
    result.provider.models.find((model) => model.id === "model-a"),
  ).toMatchObject({
    providerID: OPENAI_COMPATIBLE,
    name: "model-a",
    capabilities: { reasoning: true, toolcall: true, input: { text: true } },
    limit: { context: 1_000_000, output: 16_384 },
  });
  expect(binding.sdk.languageModel("model-a").modelId).toBe("model-a");
  await binding.dispose();
  expect(() => binding.sdk).toThrow("disposed");
});

test("enriches a unique model identity without a catalog provider", async () => {
  const baseURL = await endpoint([{ id: "model-a" }]);
  const binding = openaiCompatible.createModelProvider(catalog, { baseURL });
  const result = await binding.discover();
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(result.provider.models[0]).toMatchObject({
    id: "model-a",
    limit: { context: 1_000_000, output: 16_384 },
  });
  await binding.dispose();
});
