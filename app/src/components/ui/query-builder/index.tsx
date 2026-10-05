import type {
  ControlElementsProp,
  FullField,
  QueryBuilderContextProvider,
} from "react-querybuilder";
import { getCompatContextProvider } from "react-querybuilder";
import { ShadcnActionElement } from "./ShadcnActionElement";
import { ShadcnNotToggle } from "./ShadcnNotToggle";
import { ShadcnShiftActions } from "./ShadcnShiftActions";
import { ShadcnValueSelector } from "./ShadcnValueSelector";

export * from "./ShadcnActionElement";
export * from "./ShadcnNotToggle";
export * from "./ShadcnShiftActions";
export * from "./ShadcnValueSelector";

/**
 * @group Props
 */
export const shadcnControlElements: ControlElementsProp<FullField, string> = {
  actionElement: ShadcnActionElement,
  notToggle: ShadcnNotToggle,
  shiftActions: ShadcnShiftActions,
  valueSelector: ShadcnValueSelector,
};

/**
 * @group Components
 */
export const QueryBuilderShadcn: QueryBuilderContextProvider =
  getCompatContextProvider({
    controlElements: shadcnControlElements,
  });
