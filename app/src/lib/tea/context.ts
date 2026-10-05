// Purpose: Inject the backend connection's stable Tea capability without owning it.
import { createContext } from "react";
import type { TeaClient } from "./index";

/** The connection owner supplies a client; consumers release only their own nodes. */
export const TeaClientContext = createContext<
  Omit<TeaClient, "close"> | undefined
>(undefined);
