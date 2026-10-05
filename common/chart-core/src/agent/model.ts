// Purpose: Durable provider/model identity shared by prompt contracts and the agent runtime

import { z } from "zod";

// @agent invariant: Every prompt carries its executable provider/model
// identity. There is no product tier, slug, or backend rebinding layer.
export const AgentPromptModel = z
  .object({
    providerID: z
      .string()
      .min(1)
      .refine(
        (value) => value !== "unknown",
        "Prompt provider must be explicit",
      ),
    modelID: z
      .string()
      .min(1)
      .refine((value) => value !== "unknown", "Prompt model must be explicit"),
    selectedVariant: z.string().min(1).optional(),
  })
  .strict()
  .meta({ ref: "AgentPromptModel" });
export type AgentPromptModel = z.infer<typeof AgentPromptModel>;
