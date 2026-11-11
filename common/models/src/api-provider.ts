// Purpose: Declares a plain AI SDK provider that needs no native executable.
import type { ModelsDev } from "./catalog";
import type { ApiProviderID } from "./model-tiers";
import type { ModelProvider } from "./model-provider";

/**
 * One HTTP API provider as OpenChart sees it. It contributes standard AI SDK
 * models and no native request translation, so LLM uses the ordinary SDK path.
 * Implementations live under `providers/<id>/`; `providers/index.ts` lists them.
 * @example
 * const provider = API_PROVIDERS[id];
 * const binding = provider.createModelProvider(catalog, settings);
 */
export interface ApiProvider {
  readonly id: ApiProviderID;

  /** AI SDK `providerOptions` namespace; differs from the catalog provider ID. */
  readonly sdkKey: string;

  /**
   * Creates the lazy product binding; construction performs no I/O.
   * `providerSettings` carries the host's configuration record for this
   * provider, including any host-resolved API key.
   */
  createModelProvider(
    catalog: ModelsDev.Catalog,
    providerSettings?: Readonly<Record<string, unknown>>,
  ): ModelProvider;
}
