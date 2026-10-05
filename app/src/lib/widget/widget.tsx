// Purpose: Describe widget composition without owning its data or runtime.
import {
  createContext,
  type ComponentType,
  type PropsWithChildren,
} from "react";

import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** A frontend display type; its components subscribe to their own data. */
export interface WidgetDefinition {
  readonly kind: string;
  readonly title: string;
  readonly Icon: ComponentType<{ className?: string }>;
  readonly defaultSize: { w: number; h: number };
  readonly minSize: { w: number; h: number };
  readonly Content: ComponentType;
  readonly Controls?: ComponentType;
  readonly Provider?: ComponentType<PropsWithChildren>;
}

/** Placement identity, card interaction and the one Host placement capability; Resources remain in React Query. */
export interface WidgetContextValue {
  readonly placementId: string;
  readonly dashboardId: string;
  readonly transport: AppTransport;
  readonly holdControls: () => () => void;
  /** Return the placement of this kind showing this Resource (any placement of the kind when the widget needs no Resource, such as the one Workspace), else dock one on this placement's right and start its Dashboard save; the Dashboard's Retry/Discard own save failures. Throws while another Dashboard change is unsaved. */
  readonly placeBeside: (
    definition: WidgetDefinition,
    resourceId?: string,
  ) => string;
}

/** Provided once per placement, outside its optional feature Provider. */
export const WidgetContext = createContext<WidgetContextValue | undefined>(
  undefined,
);
