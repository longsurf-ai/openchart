// Purpose: Render Dashboard placements and own layout save/recovery feedback.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useContainerWidth } from "react-grid-layout";

import { Button } from "@openchart/app/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@openchart/app/components/ui/empty/empty";
import {
  dashboardMutationOptions,
  dashboardQueryOptions,
} from "@openchart/app/features/dashboard/api/queries";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { useUnsavedChanges } from "@openchart/app/lib/unsaved-changes/unsaved-changes";
import {
  appendWidget,
  placeWidgetBeside,
  prepareWidgetLayout,
} from "@openchart/app/features/dashboard/utils/layout";

import { DashboardGrid } from "./dashboard-grid";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";

/** Own Dashboard reads, placement edits and recovery; app supplies only feature composition. @example <DashboardView id={id} transport={transport} registry={registry} renderHeader={header} /> */
export function DashboardView({
  id,
  transport,
  registry,
  renderHeader,
  missingAction,
}: {
  id: string;
  transport: AppTransport;
  registry: Readonly<Record<string, WidgetDefinition | undefined>>;
  /** App-owned navigation shown when the Dashboard no longer exists. */
  missingAction?: ReactNode;
  renderHeader: (
    dashboard: Dashboard | undefined,
    disabled: boolean,
    addWidget: (definition: WidgetDefinition, resourceId?: string) => void,
    addChart: (definition: WidgetDefinition) => void,
  ) => ReactNode;
}) {
  const client = useQueryClient();
  const changes = useUnsavedChanges();
  const dashboard = useQuery(dashboardQueryOptions(transport, id));
  const save = useMutation(dashboardMutationOptions(transport, client, id));
  const [reset, setReset] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const container = useContainerWidth({ measureBeforeMount: true });
  const waiting =
    save.isSuccess &&
    !!dashboard.data &&
    dashboard.data.revision < save.data.revision;
  const disabled = save.isPending || save.isError || waiting || recovering;
  const addWidget = (definition: WidgetDefinition, resourceId?: string) => {
    if (disabled || !dashboard.data) return;
    save.mutate({
      expectedRevision: dashboard.data.revision,
      widgets: appendWidget(dashboard.data.widgets, definition, resourceId),
    });
  };
  const addChart = (definition: WidgetDefinition) => {
    if (disabled || !dashboard.data) return;
    save.mutate({
      expectedRevision: dashboard.data.revision,
      ...prepareWidgetLayout(dashboard.data.widgets, definition.defaultSize),
    });
  };
  const placeBeside = (
    anchorId: string,
    definition: WidgetDefinition,
    resourceId?: string,
  ) => {
    // A save still in flight already holds the placements Query will show next.
    const next =
      (save.isPending || waiting) &&
      save.variables &&
      "widgets" in save.variables
        ? save.variables.widgets
        : dashboard.data?.widgets;
    // A widget that needs no Resource, such as the one Workspace, matches by kind.
    const existing = next?.find(
      (widget) =>
        widget.kind === definition.kind &&
        (resourceId === undefined || widget.resourceId === resourceId),
    );
    if (existing) return existing.id;
    if (disabled || !dashboard.data)
      throw new Error("Another dashboard change hasn’t been saved yet.");
    const { id, widgets } = placeWidgetBeside(
      dashboard.data.widgets,
      registry,
      anchorId,
      definition,
      resourceId,
    );
    // Save failures keep the Dashboard's Retry/Discard, which replays this same placement ID.
    save.mutate({ expectedRevision: dashboard.data.revision, widgets });
    return id;
  };
  const discard = async () => {
    setRecovering(true);
    try {
      await dashboard.refetch({ throwOnError: true });
      setReset((value) => value + 1);
      save.reset();
    } catch {
      /* Query displays the refresh failure and keeps the unsaved gesture available. */
    } finally {
      setRecovering(false);
    }
  };

  if (dashboard.data === null)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-background">
        {renderHeader(undefined, true, addWidget, addChart)}
        <Empty>
          <EmptyHeader>
            <EmptyTitle>This dashboard is no longer available</EmptyTitle>
          </EmptyHeader>
          {missingAction ? <EmptyContent>{missingAction}</EmptyContent> : null}
        </Empty>
      </div>
    );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-background">
      {renderHeader(dashboard.data, disabled, addWidget, addChart)}
      {dashboard.isPending ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading dashboard…
        </p>
      ) : null}
      {dashboard.error ? (
        <div role="alert" className="jan-chat-notice">
          <Button variant="link" onClick={() => void dashboard.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {save.isError ? (
        <div role="alert" className="jan-chat-notice">
          <span>Unsaved changes</span>
          <Button
            variant="link"
            onClick={() => save.variables && save.mutate(save.variables)}
          >
            Retry
          </Button>
          <Button
            variant="link"
            disabled={recovering}
            onClick={() => {
              // Resetting RGL also unmounts its editors, so protect their drafts.
              const scopes = dashboard.data?.widgets.map(({ id }) => id) ?? [];
              if (changes) changes.close(scopes, () => void discard());
              else void discard();
            }}
          >
            Discard changes
          </Button>
        </div>
      ) : null}
      {save.isPending || waiting ? (
        <p role="status" className="px-4 text-xs text-muted-foreground">
          {save.isPending ? "Saving dashboard…" : "Refreshing dashboard…"}
        </p>
      ) : null}
      <DashboardGrid
        registry={registry}
        dashboard={dashboard.data}
        transport={transport}
        container={container}
        disabled={disabled}
        resetKey={reset}
        onSave={(snapshot, widgets) =>
          save.mutateAsync({ expectedRevision: snapshot.revision, widgets })
        }
        onPlaceBeside={placeBeside}
      />
    </div>
  );
}
