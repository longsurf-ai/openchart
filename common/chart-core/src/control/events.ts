// Purpose: Bus event definitions for control panel state changes (symbol, resolution, range, series type, layout, pane focus)
// Module:  @openchart/chart-core / control

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { BusEvent } from "@openchart/chart-core/bus/bus";
import { ControlPanelConfig } from "./config";
import { GridLayout } from "@openchart/chart-core/view/layout";

export namespace ControlPanelEvent {
  export const SymbolChange = BusEvent.define(
    "controlpanel.symbol",
    z.object({
      panelId: z.string(),
      symbol: z.string(),
    }),
  );

  export const ResolutionChange = BusEvent.define(
    "controlpanel.resolution",
    z.object({
      panelId: z.string(),
      resolution: ControlPanelConfig.Resolution,
    }),
  );

  export const RangeChange = BusEvent.define(
    "controlpanel.range",
    z.object({
      panelId: z.string(),
      range: ControlPanelConfig.Range,
    }),
  );

  export const SeriesTypeChange = BusEvent.define(
    "controlpanel.seriestype",
    z.object({
      panelId: z.string(),
      seriesType: ControlPanelConfig.SeriesType,
      chartId: z.string().optional(),
    }),
  );

  export const LayoutChange = BusEvent.define(
    "controlpanel.layout",
    z.object({
      panelId: z.string(),
      layout: GridLayout.Preset,
    }),
  );

  export const PaneFocus = BusEvent.define(
    "controlpanel.panefocus",
    z.object({
      panelId: z.string(),
      cellId: z.string().nullable(),
    }),
  );
}
