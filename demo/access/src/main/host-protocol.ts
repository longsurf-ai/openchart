// Purpose: Define the private main/utility-process capability messages; never expose them to the renderer.
import { z } from "zod";

/** Requests issued only by the application's own utility process. */
export const HostRequest = z.object({
  type: z.literal("host-request"),
  id: z.number().int(),
  operation: z.enum(["encrypt", "decrypt"]),
  value: z.string(),
});
/** Safe result of a native host capability. */
export const HostResponse = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("host-result"),
    id: z.number().int(),
    value: z.string(),
  }),
  z.object({ type: z.literal("host-error"), id: z.number().int() }),
]);
