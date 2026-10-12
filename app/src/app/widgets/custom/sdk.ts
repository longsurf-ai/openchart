// Purpose: The public `@openchart/widget` SDK: the only app module custom widget files may import.
import type { ComponentType } from "react";

export { useSymbol } from "./symbol";

export { Button } from "@openchart/app/components/ui/button";
export { Input } from "@openchart/app/components/ui/input";
export {
  useBars,
  useBarsCapabilities,
  type BarsView,
  type UseBarsResult,
} from "@openchart/app/hooks/use-bars";
export { useTea, useTeaSource, type Node } from "@openchart/app/hooks/use-tea";
export {
  barsSeries,
  type BarsCapabilities,
  type BarsRequest,
  type BarsSeries,
  type Resolution,
} from "@openchart/feed";
export type { ProviderListing } from "@openchart/market";
export { barsInputs, standardWarmupBars } from "@openchart/tea";
export { mergeByTime, type DataFrame } from "@openchart/timeseries";

/** A custom widget file's default export. `kind` and `title` must be string literals: saving reads them without running the file. */
export interface CustomWidget {
  /** Stable identity, unique across saved widgets: lowercase letters, digits and hyphens, starting with a letter. Dashboards place it as `custom:<kind>`. */
  readonly kind: string;
  /** Shown in the Widgets menu. */
  readonly title: string;
  /** Rendered inside the dashboard card; it fills the card and receives no props. */
  readonly Component: ComponentType;
}

/**
 * Declare a custom widget. Hooks inside `Component` release their own
 * subscriptions on unmount, so a widget needs no cleanup beyond its own effects.
 * @example
 * export default defineWidget({
 *   kind: "hello",
 *   title: "Hello",
 *   Component: () => <p style={{ padding: 16 }}>Hello</p>,
 * });
 */
export function defineWidget(widget: CustomWidget): CustomWidget {
  return widget;
}
