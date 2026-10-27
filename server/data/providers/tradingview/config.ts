// Purpose: Read TradingView's public data setting; cookies only deepen access.

import { providerEnabled } from "@openchart/server/data/providers/configured";

/** TradingView data is enabled by default and works anonymously. */
export const config = providerEnabled("tradingview");
