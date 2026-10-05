// Purpose: Remember which onboarding workflow is running and which of its steps the user has seen.
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { onboardingWorkflows, type OnboardingWorkflowId } from "./workflows";

const isWorkflowId = (id: string): id is OnboardingWorkflowId =>
  Object.hasOwn(onboardingWorkflows, id);

const Progress = z.object({
  /** The running workflow; an ID this build doesn't know is dropped. */
  workflow: z
    .string()
    .optional()
    .transform((id) => (id !== undefined && isWorkflowId(id) ? id : undefined)),
  /** Indexes of the running workflow's steps the user has seen. */
  seen: z.array(z.number().int().nonnegative()).default([]),
});
type Progress = z.infer<typeof Progress>;

/**
 * Device-local onboarding progress. Desktop starts `starter` for a new
 * profile. Seeing every step ends the workflow.
 * @example const running = useOnboardingProgress((state) => state.workflow);
 */
export const useOnboardingProgress = create<
  Progress & {
    /** Records the running workflow's step at this index as seen. */
    see: (index: number) => void;
  }
>()(
  persist(
    (set) => ({
      ...Progress.parse({}),
      see: (index) =>
        set(({ workflow, seen }) => {
          const steps = workflow ? onboardingWorkflows[workflow].steps : [];
          if (seen.includes(index) || index >= steps.length) return {};
          const next = [...seen, index];
          return next.length === steps.length
            ? { workflow: undefined, seen: [] }
            : { seen: next };
        }),
    }),
    {
      name: "local:onboarding",
      version: 1,
      partialize: ({ workflow, seen }) => ({ workflow, seen }),
      merge: (saved, current) => {
        const parsed = Progress.safeParse(saved);
        return parsed.success ? { ...current, ...parsed.data } : current;
      },
    },
  ),
);
