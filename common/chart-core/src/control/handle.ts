// Purpose: Facade object for a single control panel — exposes reactive getters, setters that publish bus events, and scoped event subscriptions
// Module:  @openchart/chart-core / control

import { z } from "zod";
import { Bus } from "@openchart/chart-core/bus";
import { ControlPanelStore } from "./store";
import { ControlPanelConfig } from "./config";
import { ControlPanelEvent } from "./events";
import { GridLayout } from "@openchart/chart-core/view/layout";

type SymbolChangePayload = z.infer<
  typeof ControlPanelEvent.SymbolChange.schema
>;
type ResolutionChangePayload = z.infer<
  typeof ControlPanelEvent.ResolutionChange.schema
>;
type RangeChangePayload = z.infer<typeof ControlPanelEvent.RangeChange.schema>;
type SeriesTypeChangePayload = z.infer<
  typeof ControlPanelEvent.SeriesTypeChange.schema
>;
type LayoutChangePayload = z.infer<
  typeof ControlPanelEvent.LayoutChange.schema
>;

export function controlPanelHandle(id: string) {
  const get = () => ControlPanelStore.get(id);

  return {
    id,

    // State getters
    get symbol() {
      return get().state.symbol;
    },
    get resolution() {
      return get().state.resolution;
    },
    get range() {
      return get().state.range;
    },
    get seriesType() {
      return get().state.seriesType;
    },
    get layout() {
      return get().state.layout;
    },
    get focusedCellId() {
      return get().state.focusedCellId;
    },

    // State setters
    setSymbol(symbol: string) {
      const entry = get();
      entry.state.symbol = symbol;
      Bus.publish(ControlPanelEvent.SymbolChange, { panelId: id, symbol });
    },

    setResolution(resolution: ControlPanelConfig.Resolution) {
      const entry = get();
      entry.state.resolution = resolution;
      Bus.publish(ControlPanelEvent.ResolutionChange, {
        panelId: id,
        resolution,
      });
    },

    setRange(range: ControlPanelConfig.Range) {
      const entry = get();
      entry.state.range = range;
      Bus.publish(ControlPanelEvent.RangeChange, { panelId: id, range });
    },

    setSeriesType(seriesType: ControlPanelConfig.SeriesType) {
      const entry = get();
      entry.state.seriesType = seriesType;
      Bus.publish(ControlPanelEvent.SeriesTypeChange, {
        panelId: id,
        seriesType,
        chartId: entry.state.focusedCellId ?? undefined,
      });
    },

    setLayout(layout: GridLayout.Preset) {
      const entry = get();
      entry.state.layout = layout;
      Bus.publish(ControlPanelEvent.LayoutChange, { panelId: id, layout });
    },

    // Event subscriptions
    onSymbolChange(handler: (symbol: string) => void) {
      return Bus.subscribe(
        ControlPanelEvent.SymbolChange,
        (e: SymbolChangePayload) => {
          if (e.panelId === id) handler(e.symbol);
        },
      );
    },

    onResolutionChange(
      handler: (resolution: ControlPanelConfig.Resolution) => void,
    ) {
      return Bus.subscribe(
        ControlPanelEvent.ResolutionChange,
        (e: ResolutionChangePayload) => {
          if (e.panelId === id) handler(e.resolution);
        },
      );
    },

    onRangeChange(handler: (range: ControlPanelConfig.Range) => void) {
      return Bus.subscribe(
        ControlPanelEvent.RangeChange,
        (e: RangeChangePayload) => {
          if (e.panelId === id) handler(e.range);
        },
      );
    },

    onSeriesTypeChange(
      handler: (
        seriesType: ControlPanelConfig.SeriesType,
        chartId?: string,
      ) => void,
    ) {
      return Bus.subscribe(
        ControlPanelEvent.SeriesTypeChange,
        (e: SeriesTypeChangePayload) => {
          if (e.panelId === id) handler(e.seriesType, e.chartId);
        },
      );
    },

    onLayoutChange(handler: (layout: GridLayout.Preset) => void) {
      return Bus.subscribe(
        ControlPanelEvent.LayoutChange,
        (e: LayoutChangePayload) => {
          if (e.panelId === id) handler(e.layout);
        },
      );
    },

    // Cleanup
    remove() {
      ControlPanelStore.remove(id);
    },
  };
}

export type ControlPanelHandle = ReturnType<typeof controlPanelHandle>;
