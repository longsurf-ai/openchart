// Purpose: Offer the Pine conversion film only after indicator discovery or a new Workspace placement.
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useMatch } from "react-router";

import { dashboardQueryOptions } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

import { useOnboardingProgress } from "./trellis/progress";

/**
 * Mount once in Layout. Call the returned callback when the user opens the
 * indicator library. A newly saved Workspace widget on the current Dashboard
 * offers the same film; initial reads, existing placements and page navigation
 * never offer it. Query owns Dashboard data and releases observation on unmount.
 * An offer waits for another tour to finish on this page and expires on leaving
 * it. Trellis persists one shared offer history across both entry points.
 * Failed reads or saves cannot count as adding a widget. This hook writes no
 * product resources and performs no navigation.
 * @example const onOpenIndicators = usePineConversionOnboarding(transport);
 */
export function usePineConversionOnboarding(transport: AppTransport) {
  const { pathname } = useLocation();
  const [requestedOn, setRequestedOn] = useState<string>();
  const offer = useCallback(() => setRequestedOn(pathname), [pathname]);
  const dashboardRoute = useMatch("/app/dashboards/:dashboardId");
  const dashboardId = dashboardRoute?.params.dashboardId;
  const dashboard = useQuery({
    ...dashboardQueryOptions(transport, dashboardId ?? ""),
    enabled: Boolean(dashboardId),
  });
  const previous = useRef<{ id?: string; hasWorkspace?: boolean }>({});
  useEffect(() => {
    if (previous.current.id !== dashboardId)
      previous.current = { id: dashboardId };
    if (!dashboardId || !dashboard.isSuccess) return;
    const hasWorkspace = dashboard.data.widgets.some(
      (widget) => widget.kind === "workspace",
    );
    const added = previous.current.hasWorkspace === false && hasWorkspace;
    previous.current = { id: dashboardId, hasWorkspace };
    if (added) offer();
  }, [dashboardId, dashboard.isSuccess, dashboard.data, offer]);
  const { workflow, startOnce } = useOnboardingProgress();
  useEffect(() => {
    if (requestedOn === undefined) return;
    if (requestedOn !== pathname) setRequestedOn(undefined);
    else if (!workflow) {
      startOnce("pine-conversion");
      setRequestedOn(undefined);
    }
  }, [requestedOn, pathname, workflow, startOnce]);
  return offer;
}
