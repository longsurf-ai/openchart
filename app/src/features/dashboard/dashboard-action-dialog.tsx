// Purpose: Rename saved Dashboards and confirm their deletion with shared dialogs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import { Input } from "@openchart/app/components/ui/input";
import {
  type Dashboard,
  dashboardQueryOptions,
  deleteDashboardMutationOptions,
  useRenameDashboard,
} from "@openchart/app/features/dashboard/api/queries";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Both actions edit a persisted Dashboard; creation needs no dialog. */
export type DashboardDialogAction = {
  type: "rename" | "delete";
  dashboard: Dashboard;
};

type DashboardDialogProps = {
  transport: AppTransport;
  onClose: () => void;
  onDeleted: (id: string) => void;
};

/**
 * Show the selected action, or nothing when closed. Query supplies the latest
 * Dashboard revision while the keyed form preserves drafts across refetches.
 * Changing actions or closing resets the form; failed mutations stay open for
 * retry. Deletion confirms the selected name snapshot; on success it notifies
 * the caller, which owns navigation, then closes.
 * @example <DashboardActionDialog action={dashboards.action} transport={transport} onClose={dashboards.close} onDeleted={leave} />
 */
export function DashboardActionDialog({
  action,
  transport,
  ...callbacks
}: DashboardDialogProps & { action: DashboardDialogAction | undefined }) {
  if (!action) return null;
  return (
    <DashboardActionForm
      key={`${action.type}:${action.dashboard.id}`}
      action={action}
      transport={transport}
      {...callbacks}
    />
  );
}

function DashboardActionForm({
  action,
  transport,
  onClose,
  onDeleted,
}: DashboardDialogProps & { action: DashboardDialogAction }) {
  const { data: dashboard } = useQuery({
    ...dashboardQueryOptions(transport, action.dashboard.id),
    initialData: action.dashboard,
    enabled: action.type === "rename",
  });
  const [name, setName] = useState(action.dashboard.name);
  const queryClient = useQueryClient();
  const rename = useRenameDashboard(transport);
  // Hook-level callbacks read the latest props, so completion sees the current route.
  const remove = useMutation({
    ...deleteDashboardMutationOptions(transport, queryClient),
    onSettled: (_result, error, id) => {
      if (error) return;
      onDeleted(id);
      onClose();
    },
  });
  const deleting = action.type === "delete";
  const mutation = deleting ? remove : rename;
  const [label, pendingLabel] = deleting
    ? ["Delete", "Deleting…"]
    : ["Save", "Saving…"];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {deleting ? "Delete dashboard" : "Rename dashboard"}
          </DialogTitle>
          <DialogDescription className="break-words">
            {deleting
              ? `Delete “${action.dashboard.name}” and its contents? This cannot be undone.`
              : dashboard === null
                ? "This dashboard is no longer available."
                : "Give this dashboard a name."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (mutation.isPending) return;
            if (deleting) {
              remove.mutate(action.dashboard.id);
            } else if (dashboard && name.trim()) {
              rename.mutate(
                { dashboard, name: name.trim() },
                { onSuccess: onClose },
              );
            }
          }}
        >
          {!deleting ? (
            <Input
              aria-label="Dashboard name"
              value={name}
              disabled={mutation.isPending || !dashboard}
              onChange={(event) => setName(event.target.value)}
            />
          ) : null}

          <DialogFooter className="mt-4">
            <Button
              variant="ghost"
              onClick={onClose}
              type="button"
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={deleting ? "destructive" : "default"}
              disabled={
                mutation.isPending ||
                (!deleting && (!dashboard || !name.trim()))
              }
            >
              {mutation.isPending ? pendingLabel : label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
