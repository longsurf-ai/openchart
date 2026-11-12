// Purpose: OpenAI-compatible HTTP discovery and standard AI SDK model access.
import type { ProviderV4 } from "@ai-sdk/provider";
import type { ApiProvider } from "@openchart/models/api-provider";
import type { ModelsDev } from "@openchart/models/catalog";
import { OPENAI_COMPATIBLE } from "@openchart/models/model-tiers";
import type {
  AvailableModel,
  ModelProvider,
} from "@openchart/models/model-provider";
import {
  catalogModelMetadata,
  resolveCatalogProvider,
} from "@openchart/models/providers/model-catalog";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

const DISCOVERY_TIMEOUT_MS = 15_000;

function validBaseURL(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Host configuration for the API provider. `apiKey` is reserved for hosts that
 * resolve a key themselves; it is never part of the config schema.
 */
const ProviderSettings = z.looseObject({
  baseURL: z.string().optional(),
  catalogProvider: z.string().optional(),
  apiKey: z.string().optional(),
});

const ModelList = z.object({
  data: z.array(z.object({ id: z.string() })),
});

/**
 * Projects one OpenAI `/models` row. The models.dev catalog enriches known
 * identities; unknown endpoints keep unknown capabilities instead of guessing.
 */
function enrichModel(
  id: string,
  metadata: ModelsDev.Model | undefined,
): AvailableModel {
  const enriched = catalogModelMetadata(metadata);
  return {
    kind: "language",
    providerID: OPENAI_COMPATIBLE,
    id,
    name: id,
    capabilities: {
      ...enriched.capabilities,
      input: { text: true, ...enriched.capabilities.input },
      output: { text: true, ...enriched.capabilities.output },
    },
    ...(enriched.cost ? { cost: enriched.cost } : {}),
    ...(enriched.limit ? { limit: enriched.limit } : {}),
  };
}

async function listModels(
  baseURL: string,
  apiKey: string | undefined,
): Promise<string[]> {
  const url = `${baseURL.replace(/\/+$/, "")}/models`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "OpenChart/V2",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(
      `OpenAI-compatible model list failed (HTTP ${response.status}).`,
    );
  const parsed = ModelList.parse(await response.json());
  return [...new Set(parsed.data.map((model) => model.id))];
}

/**
 * Creates a lazy HTTP binding. Construction performs no I/O; discovery reads
 * the configured `/models` endpoint and the models.dev catalog. Requests use
 * the standard AI SDK, so OpenChart executes host tools itself.
 * @example
 * const binding = openaiCompatible.createModelProvider(catalog, {
 *   baseURL: "https://api.openai.com/v1",
 *   apiKey: "sk-…",
 * });
 */
function createModelProvider(
  catalog: ModelsDev.Catalog,
  providerSettings?: Readonly<Record<string, unknown>>,
): ModelProvider {
  const settings = ProviderSettings.parse(providerSettings ?? {});
  const baseURL = settings.baseURL ?? "";
  const catalogProvider = settings.catalogProvider ?? "";
  let disposed = false;
  let sdk: ProviderV4 | undefined;

  function apiKey() {
    return settings.apiKey;
  }

  function getSDK() {
    if (disposed) throw new Error("OpenAI-compatible binding is disposed");
    if (!baseURL) throw new Error("OpenAI-compatible base URL is not set");
    const key = apiKey();
    return (sdk ??= createOpenAICompatible({
      name: OPENAI_COMPATIBLE,
      baseURL,
      ...(key ? { apiKey: key } : {}),
      includeUsage: true,
    }));
  }

  return {
    id: OPENAI_COMPATIBLE,
    get sdk() {
      return getSDK();
    },
    async discover() {
      if (disposed) throw new Error("OpenAI-compatible binding is disposed");
      if (!baseURL)
        return {
          status: "configuration_required",
          message: "Set an OpenAI-compatible base URL.",
        } as const;
      if (!validBaseURL(baseURL))
        return {
          status: "configuration_required",
          message: "Set a valid http(s) OpenAI-compatible base URL.",
        } as const;
      const key = apiKey();
      const [ids, catalogProviders] = await Promise.all([
        listModels(baseURL, key),
        catalog.get(),
      ]);
      if (disposed) throw new Error("OpenAI-compatible binding is disposed");
      const providerKey = resolveCatalogProvider(
        catalogProviders,
        baseURL,
        ids,
        catalogProvider,
      );
      const metadata = providerKey
        ? catalogProviders[providerKey]?.models
        : undefined;
      return {
        status: "ready",
        provider: {
          id: OPENAI_COMPATIBLE,
          name: "OpenAI-compatible",
          models: ids.map((id) => enrichModel(id, metadata?.[id])),
        },
      };
    },
    async readQuota() {
      return { status: "not_applicable" };
    },
    async dispose() {
      disposed = true;
    },
  };
}

/** OpenAI-compatible HTTP provider; no native executable or request adapter. */
export const openaiCompatible: ApiProvider = {
  id: OPENAI_COMPATIBLE,
  sdkKey: "openaiCompatible",
  createModelProvider,
};
