// Purpose: Read Binance's public data setting; no credential is required.
import { providerEnabled } from "@openchart/server/data/providers/configured";

/** Binance public data is enabled by default. */
export const config = providerEnabled("binance");
