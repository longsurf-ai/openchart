// Purpose: Locks catalog enrichment thresholds and unknown metadata semantics.

import { describe, expect, it } from "vitest";
import { ModelsDev } from "@openchart/models/catalog";
import { catalogModelMetadata, resolveCatalogProvider } from "./model-catalog";

function catalogModel() {
  return ModelsDev.Model.parse({
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    release_date: "2026-05-07",
    attachment: true,
    reasoning: true,
    temperature: true,
    tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1_000_000, output: 65_536 },
    cost: {
      input: 1,
      output: 6,
      cache_read: 0.1,
      tiers: [
        {
          input: 2,
          output: 9,
          cache_read: 0.2,
          tier: { type: "context", size: 272_000 },
        },
      ],
    },
  });
}

describe("catalogModelMetadata", () => {
  it("preserves capabilities, limits, and cost thresholds without mutating the catalog", () => {
    const catalog = catalogModel();
    const original = structuredClone(catalog);
    const metadata = catalogModelMetadata(catalog);

    expect(metadata).toMatchObject({
      capabilities: {
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, image: true },
        output: { text: true, image: false },
      },
      limit: { context: 1_000_000, output: 65_536 },
      cost: {
        input: 1,
        output: 6,
        cache: { read: 0.1, write: undefined },
        contextTiers: [
          {
            threshold: 272_000,
            input: 2,
            output: 9,
            cache: { read: 0.2, write: undefined },
          },
        ],
      },
    });
    expect(catalog).toEqual(original);
  });

  it("keeps unknown prices and modalities unknown", () => {
    const catalog = catalogModel();
    delete catalog.cost;
    delete catalog.modalities;

    const metadata = catalogModelMetadata(catalog);

    expect(metadata.cost).toBeUndefined();
    expect(metadata.capabilities.input).toEqual({});
    expect(metadata.capabilities.output).toEqual({});
  });
});

function provider(ids: readonly string[], api?: string) {
  return ModelsDev.Provider.parse({
    ...(api ? { api } : {}),
    models: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          attachment: false,
          reasoning: false,
          tool_call: false,
          limit: { context: 1, output: 1 },
        },
      ]),
    ),
  });
}

describe("resolveCatalogProvider", () => {
  it("honors an explicit key", () => {
    const catalog = { deepinfra: provider([]), openai: provider([]) };
    expect(
      resolveCatalogProvider(
        catalog,
        "https://api.deepinfra.com/v1/openai",
        [],
        "openai",
      ),
    ).toBe("openai");
  });

  it("infers the provider from the endpoint host", () => {
    const catalog = {
      deepinfra: provider([], "https://api.deepinfra.com/v1/openai"),
      openai: provider([]),
    };
    expect(
      resolveCatalogProvider(
        catalog,
        "https://api.deepinfra.com/v1/openai",
        [],
      ),
    ).toBe("deepinfra");
  });

  it("falls back to a unique model identity", () => {
    const catalog = {
      alpha: provider(["model-a"]),
      beta: provider(["model-b"]),
    };
    expect(
      resolveCatalogProvider(catalog, "http://127.0.0.1:8080/v1", ["model-a"]),
    ).toBe("alpha");
  });

  it("leaves ambiguous identities and hosts unenriched", () => {
    const catalog = {
      alpha: provider(["model-a"]),
      beta: provider(["model-a"]),
      openai: provider([]),
      azure: provider([]),
    };
    expect(
      resolveCatalogProvider(catalog, "http://127.0.0.1:8080/v1", ["model-a"]),
    ).toBeUndefined();
    expect(
      resolveCatalogProvider(catalog, "https://openai.azure.com/v1", []),
    ).toBeUndefined();
  });
});
