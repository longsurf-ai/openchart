// Purpose: Read Yahoo Finance's public data setting; no credential is required.
import { providerEnabled } from "@openchart/server/data/providers/configured";

/** Yahoo public data is enabled by default. */
export const config = providerEnabled("yfinance");
