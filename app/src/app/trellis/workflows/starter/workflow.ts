// Purpose: Connect a new profile's agent and turn on notifications, introduce dashboards, chart controls, Agent-made indicators, agents and alerts through the content Desktop installs on first launch, then ask for a GitHub star and a Discord join back on the dashboard.
import { lazy } from "react";

import { communityUrls } from "@openchart/app/app/community-urls";
import { OpenRouteAction } from "@openchart/app/app/trellis/actions";
import { CardView, PageView } from "@openchart/app/app/trellis/views";
import type { OnboardingWorkflow } from "@openchart/app/app/trellis/workflows";

import agentIndicatorVideo from "./agent-indicator.mp4";
import askAgentVideo from "./ask-agent.mp4";
import chartControlsVideo from "./chart-controls.mp4";
import drawingAlertVideo from "./drawing-alert.mp4";
import selectExplainVideo from "./select-explain.mp4";
import starGithubVideo from "./star-github.mp4";

const dashboard = "/app/dashboards/dsh_88JOx0yX7TH65p";

/**
 * The first-launch workflow: connecting Claude Code or Codex, turning on notifications, the Bitcoin dashboard with its chart controls
 * and an Agent-made indicator, the Agent thread behind it and the alert it set, then, back on the dashboard, an ask to star the repository and join Discord. Its IDs must match
 * `platform/desktop/src/onboarding/content`, which starts it.
 * @example starterWorkflow.steps[2].action;
 */
export const starterWorkflow = {
  steps: [
    // Loaded on first launch only; Desktop's content test reads these steps without the pages' UI.
    {
      countInProgress: false,
      view: new PageView(
        lazy(() =>
          import("./connect-agents-page").then((module) => ({
            default: module.ConnectAgentsPage,
          })),
        ),
      ),
    },
    {
      countInProgress: false,
      view: new PageView(
        lazy(() =>
          import("./notifications-page").then((module) => ({
            default: module.NotificationsPage,
          })),
        ),
      ),
    },
    {
      action: new OpenRouteAction(dashboard),
      view: new CardView({
        title: "Watch the market from your dashboard",
        body: "Dashboards are your window on the market. The Agent analyzes with you: select a range on a chart and it explains the move, right on the candles.",
        video: selectExplainVideo,
      }),
    },
    // Films of fixed captures: playing them never runs the Agent or edits the user's charts.
    {
      action: new OpenRouteAction(dashboard),
      view: new CardView({
        title: "Make the chart yours",
        body: "Switch the interval, add a study from the library, then tune its inputs and style. Every change applies to the chart in front of you.",
        video: chartControlsVideo,
      }),
    },
    {
      action: new OpenRouteAction(dashboard),
      view: new CardView({
        title: "Ask the Agent for an indicator",
        body: "Describe the study you want. The Agent writes it, adds it to a chart and confirms when it's ready. Open its code from the legend to read or edit it.",
        video: agentIndicatorVideo,
      }),
    },
    {
      action: new OpenRouteAction("/app/sessions/ses_rrbFx6CsSf2Xk8"),
      view: new CardView({
        title: "All your agents, in one place",
        body: "Every agent working for you shows up here, from chart explanations to alert research. Ask in plain words and they analyze, research and set things up for you.",
        video: askAgentVideo,
      }),
    },
    {
      action: new OpenRouteAction("/app/alerts/rules/alr_88PH5QdFSkCg4R"),
      view: new CardView({
        title: "Alerts put agents to work",
        body: "When an alert fires, you get a notification and the Agent starts researching on its own. Connect Codex or Claude Code so your agents can run.",
        video: drawingAlertVideo,
      }),
    },
    {
      action: new OpenRouteAction(dashboard),
      view: new CardView({
        title: "Star us on GitHub",
        body: "If OpenChart helps your trading, a star on GitHub encourages us to build better tools for you. Join our Discord to share ideas and get help.",
        video: starGithubVideo,
        links: [
          { label: "Open GitHub", url: communityUrls.github },
          { label: "Join Discord", url: communityUrls.discord },
        ],
      }),
    },
  ],
} satisfies OnboardingWorkflow;
