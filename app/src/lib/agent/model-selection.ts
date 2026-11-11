// Purpose: Derive model menu visibility and resolve supported tier selections.
import {
  API_PROVIDER_IDS,
  MODEL_TIER_IDS,
} from "@openchart/models/model-tiers";
import type {
  AgentClient,
  ModelSelection,
} from "@openchart/app/lib/agent/client";

/** Orders picker choices by provider, then model name, then ID. @example choices.sort(compareModelChoices); */
export function compareModelChoices(
  left: { providerID: string; name: string; id: string },
  right: { providerID: string; name: string; id: string },
) {
  return (
    left.providerID.localeCompare(right.providerID) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

/** Offer native tiers actually present and every discovered API model. @example const options = models.filter(isModelMenuOption); */
export function isModelMenuOption(model: {
  id: string;
  providerID: string;
  tier?: number;
}) {
  if (API_PROVIDER_IDS.some((id) => id === model.providerID)) return true;
  return (
    model.tier !== undefined && MODEL_TIER_IDS[model.tier - 1] === model.id
  );
}

/**
 * Uses the first visible menu option only when no preference exists. Unavailable
 * choices stay unresolved; unsupported variants retain the existing default behavior.
 * @example const model = resolveModel(providers, selection);
 */
export function resolveModel(
  providers: Awaited<ReturnType<AgentClient["models"]>>,
  preferred?: {
    providerID: string;
    modelID: string;
    selectedVariant?: string;
  } | null,
): ModelSelection | undefined {
  const available = preferred
    ? providers
        .find((provider) => provider.id === preferred.providerID)
        ?.models.find((model) => model.id === preferred.modelID)
    : providers.flatMap((provider) => provider.models).find(isModelMenuOption);
  return available
    ? {
        providerID: available.providerID,
        modelID: available.id,
        ...(preferred?.selectedVariant &&
        available.availableVariants?.includes(preferred.selectedVariant)
          ? { selectedVariant: preferred.selectedVariant }
          : {}),
      }
    : undefined;
}
