// Purpose: Registers the Resources shared by HTTP, Agent tools, and prompt discovery.

import { dashboardResource } from "@openchart/server/resources/dashboard";
import { chartResource } from "@openchart/server/resources/chart";
import { indicatorResource } from "@openchart/server/resources/indicator";
import { drawingResource } from "@openchart/server/resources/drawing";
import { workspaceResource } from "@openchart/server/resources/workspace";
import { agentScheduleResource } from "@openchart/server/resources/agent-schedule";
import { agentScheduleOccurrenceResource } from "@openchart/server/resources/agent-schedule-occurrence";
import { alertRuleResource } from "@openchart/server/resources/alert-rule";
import { alertEventResource } from "@openchart/server/resources/alert-event";
import { triggerResource } from "@openchart/server/resources/trigger";
import { postResource } from "@openchart/server/resources/post";
import { Schema } from "effect";
import { symbologyResource } from "@openchart/server/resources/symbology";
import { watchlistResource } from "@openchart/server/resources/watchlist";

/** The sole Resource catalog; every public surface derives from these definitions. */
export const resources = [
  dashboardResource,
  chartResource,
  indicatorResource,
  drawingResource,
  workspaceResource,
  agentScheduleResource,
  agentScheduleOccurrenceResource,
  alertRuleResource,
  alertEventResource,
  triggerResource,
  symbologyResource,
  postResource,
  watchlistResource,
] as const;

/** Public Resource names always match the registered catalog. */
export const ResourceName = Schema.Literals(
  resources.map((resource) => resource.name),
);
