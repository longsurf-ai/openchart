// Purpose: Projects catalog enrichment shared by native provider bindings without inventing availability.
import type { ModelsDev } from "@openchart/models/catalog";
import type { AvailableModel } from "@openchart/models/model-provider";

/**
 * Projects a known modality set; omission means unknown, not unsupported.
 * @example
 * const input = modelModalities(['text', 'image']);
 */
export function modelModalities(
  values: readonly string[] | undefined,
): AvailableModel["capabilities"]["input"] {
  if (values === undefined) return {};
  return {
    text: values.includes("text"),
    audio: values.includes("audio"),
    image: values.includes("image"),
    video: values.includes("video"),
    pdf: values.includes("pdf"),
  };
}

/**
 * Resolves the catalog bucket for an OpenAI-compatible endpoint. An explicit
 * key wins; otherwise the endpoint host identifies a provider, and a unique
 * model identity is the last resort. Ambiguous identities stay unenriched
 * because providers publish different prices and limits for the same model.
 * @example const key = resolveCatalogProvider(catalog, baseURL, ids);
 */
export function resolveCatalogProvider(
  catalog: Readonly<Record<string, ModelsDev.Provider>>,
  baseURL: string,
  modelIDs: readonly string[],
  configured = "",
): string | undefined {
  if (configured && catalog[configured]) return configured;

  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  let host: string | undefined;
  try {
    host = new URL(baseURL).hostname.toLowerCase();
  } catch {
    host = undefined;
  }
  if (host) {
    const labels = host
      .split(".")
      .filter((label) => label && label !== "api" && label !== "www");
    const matches = Object.entries(catalog).filter(([key, provider]) => {
      if (provider.api) {
        try {
          if (new URL(provider.api).hostname.toLowerCase() === host)
            return true;
        } catch {
          // Ignore malformed catalog URLs and fall through to name matching.
        }
      }
      const name = normalize(key);
      return labels.some((label) => {
        const candidate = normalize(label);
        return (
          candidate === name ||
          (candidate.length > 3 && name.startsWith(candidate)) ||
          (name.length > 3 && candidate.startsWith(name))
        );
      });
    });
    if (matches.length === 1) return matches[0]?.[0];
  }

  const candidates = new Set<string>();
  for (const id of modelIDs) {
    const providers = Object.entries(catalog)
      .filter(([, provider]) => provider.models[id])
      .map(([key]) => key);
    if (providers.length === 0) continue;
    if (providers.length > 1) return undefined;
    candidates.add(providers[0]!);
    if (candidates.size > 1) return undefined;
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

/**
 * Enriches an already discovered model. Unknown prices, limits, and capabilities
 * stay omitted; API reference prices never imply a CLI account's actual bill.
 * Native identities and variants remain the binding's responsibility.
 * @example
 * const metadata = catalogModelMetadata(catalog.anthropic?.models[resolvedID]);
 */
export function catalogModelMetadata(
  model: ModelsDev.Model | undefined,
): Pick<AvailableModel, "capabilities" | "cost" | "limit"> {
  const price = model?.cost;
  return {
    capabilities: {
      temperature: model?.temperature,
      reasoning: model?.reasoning,
      attachment: model?.attachment,
      toolcall: model?.tool_call,
      input: modelModalities(model?.modalities?.input),
      output: modelModalities(model?.modalities?.output),
    },
    cost: price && {
      input: price.input,
      output: price.output,
      cache: { read: price.cache_read, write: price.cache_write },
      contextTiers: (
        price.tiers ??
        (price.context_over_200k
          ? [
              {
                ...price.context_over_200k,
                tier: { type: "context" as const, size: 200_000 },
              },
            ]
          : [])
      )
        .map((tier) => ({
          threshold: tier.tier.size,
          input: tier.input,
          output: tier.output,
          cache: { read: tier.cache_read, write: tier.cache_write },
        }))
        .sort((left, right) => left.threshold - right.threshold),
    },
    limit: model && { ...model.limit },
  };
}
