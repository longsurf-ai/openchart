// Purpose: Connect the renderer to the demo runtime through the shared tRPC contract.

import {
  createTRPCClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import type { AppRouter } from "@openchart/server/contract";

/** Typed transport to this Electron application's backend; no server code enters the renderer. */
export const server = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (operation) => operation.type === "subscription",
      true: httpSubscriptionLink({ url: window.accessDemo.serverURL }),
      false: httpLink({ url: window.accessDemo.serverURL }),
    }),
  ],
});
