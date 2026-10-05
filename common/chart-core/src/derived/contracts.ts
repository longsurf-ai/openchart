// Purpose: Type contracts for derived/scripted series — defines inputs, outputs, and runtime context for user scripts
// Module:  @openchart/chart-core / derived

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import type { BarsRequest } from "@openchart/feed";
import type { ProviderListing } from "@openchart/market";
import { Series } from "@openchart/chart-core/series";

export namespace DerivedContracts {
  export type FetchSeriesRequest = BarsRequest;

  export type OutputScaleMode =
    "same-scale" | "same-percent-scale" | "new-price-scale";
  export type OutputPaneMode = "same-pane" | "new-pane";

  export type OutputSeries = {
    name: string;
    type?: Series.Type;
    data: unknown[];
    pane?: OutputPaneMode;
    scale?: OutputScaleMode;
    options?: Partial<Series.Options>;
  };

  export type ScriptResult = {
    outputs: OutputSeries[];
  };

  export type ScriptRuntimeContext = {
    mainSeries: unknown[];
    market?: ProviderListing;
    resolution?: string;
    params?: Record<string, unknown>;
    fetchSeries: (request: FetchSeriesRequest) => Promise<unknown[]>;
  };
}
