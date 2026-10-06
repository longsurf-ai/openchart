// Purpose: Demonstrate moving a Pine indicator into Workspace and onto an NVDA chart.
import { lazy } from "react";
import { PageView } from "@openchart/app/app/trellis/views";
import type { OnboardingWorkflow } from "@openchart/app/app/trellis/workflows";

/**
 * A one-time, silent demonstration offered by opening Indicators or adding a
 * Workspace widget. The film
 * follows one NVDA indicator through copy, conversion, and Add to chart; playing
 * it creates no files, sessions, or chart resources. The shared host owns dismissal.
 * @example onboardingWorkflows["pine-conversion"].steps[0].view;
 */
export const pineConversionWorkflow = {
  steps: [
    {
      countInProgress: false,
      view: new PageView(
        lazy(() =>
          import("./video-page").then((module) => ({
            default: module.PineConversionPage,
          })),
        ),
      ),
    },
  ],
} satisfies OnboardingWorkflow;
