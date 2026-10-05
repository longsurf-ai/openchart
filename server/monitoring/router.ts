// Purpose: Expose current Monitoring statuses to the app.
import { trpc } from "@openchart/server/lib/trpc";

import { Monitoring } from "./monitoring";

/** Read-only Monitoring procedures. */
export const monitoringRouter = trpc.router({
  /** Every current Status; invalidated by the `monitoring.changed` event. */
  status: trpc.procedure.query(({ ctx }) =>
    ctx.runtime.runPromise(
      Monitoring.Service.use((monitoring) => monitoring.status),
    ),
  ),
});
