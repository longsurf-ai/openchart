// Purpose: Own Dashboard creation, dialog selection and their app navigation callbacks.
import { useState } from "react";
import { useMatch, useNavigate } from "react-router";

import { useSidebar } from "@openchart/app/components/ui/sidebar";
import {
  type Dashboard,
  useCreateDashboard,
} from "@openchart/app/features/dashboard/api/queries";
import type { DashboardDialogAction } from "@openchart/app/features/dashboard/dashboard-action-dialog";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/**
 * Mount once in Layout to share Dashboard actions between sidebar and shortcuts.
 * Creation saves a Dashboard with its default Chart, closes the mobile sidebar and
 * navigates after success; a pending save ignores repeats and a failure is
 * exposed as `createFailed` until the next attempt. Opening rename or delete
 * performs no writes; the dialog owns those mutations and closing discards its draft.
 * @example const dashboards = useDashboardActions(transport); dashboards.create();
 */
export function useDashboardActions(transport: AppTransport) {
  const [action, setAction] = useState<DashboardDialogAction>();
  const route = useMatch("/app/dashboards/:dashboardId");
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const creation = useCreateDashboard(transport);

  return {
    action,
    createFailed: creation.isError,
    create() {
      if (creation.isPending) return;
      setOpenMobile(false);
      creation.mutate(undefined, {
        onSuccess: (dashboard) => {
          void navigate(`/app/dashboards/${dashboard.id}`);
        },
      });
    },
    openRename(dashboard: Dashboard) {
      setAction({ type: "rename", dashboard });
    },
    openDelete(dashboard: Dashboard) {
      setAction({ type: "delete", dashboard });
    },
    close() {
      setAction(undefined);
    },
    onDeleted(id: string) {
      if (route?.params.dashboardId === id) {
        void navigate("/app", { replace: true });
      }
    },
  };
}
