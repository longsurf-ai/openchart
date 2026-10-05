// Purpose: Inject stable chart capabilities into the chart's children.
import { createContext } from "react";

import type { ChartRuntime } from "./store";

/** A chart subtree's mounted runtime; readers select state through Zustand. */
export const ChartContext = createContext<ChartRuntime | undefined>(undefined);
