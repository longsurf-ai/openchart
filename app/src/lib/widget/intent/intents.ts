// Purpose: Declare every cross-widget intent once, so raisers and handlers share one name and payload.
import type { ProviderListing } from "@openchart/market";

import { defineIntent } from "./intent";

/**
 * Show a provider listing on a chart; FDC3's `ViewChart`. The chart that
 * answers decides which of its cells changes. Only the newest request matters
 * while one is applying, so rapid picks skip the symbols in between.
 * @example const outcome = await router.raise(viewChart, { listing }, { placementId });
 */
export const viewChart = defineIntent<{ readonly listing: ProviderListing }>(
  "ViewChart",
  { delivery: "latest" },
);
