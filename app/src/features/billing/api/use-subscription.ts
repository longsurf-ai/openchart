// Purpose: Query current-account billing and open hosted flows without retaining links or another account's results.
import { useUser } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAppHost } from "@openchart/app/lib/host/host";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  cloudPlan,
  type BillingInterval,
} from "@openchart/app/features/billing/cloud-plan";

type BillingAction =
  { kind: "checkout"; interval: BillingInterval } | { kind: "portal" };
type Subscription = Awaited<
  ReturnType<
    AppTransport["rpc"]["access"]["billing"]["getSubscription"]["query"]
  >
>;

/** Accounts without a live subscription may check out; Cloud alone decides trial eligibility.
 * @example if (offersSubscription(value)) checkout();
 */
export function offersSubscription(value: Subscription): value is
  | Extract<Subscription, { status: "none" }>
  | (Exclude<Subscription, { status: "none" }> & {
      status: "canceled" | "incomplete_expired";
    }) {
  return (
    value.status === "none" ||
    value.status === "canceled" ||
    value.status === "incomplete_expired"
  );
}

/** Billing for the signed-in Clerk user, cached per user so revisits render at once while
 * mount, focus and browser return requery facts. Unmount drops in-flight handoffs.
 * onStatusChange reports a cloud status that differs from the cached one, never the first
 * read (providers check access when they start), a failed read or a browser return alone.
 * @example const billing = useSubscription(transport);
 */
export function useSubscription(
  transport: AppTransport,
  onStatusChange?: () => void,
) {
  const host = useAppHost();
  const queries = useQueryClient();
  const { user } = useUser();
  const key = ["billing", user?.id] as const;
  const generation = useRef({ revision: 0 });
  const subscription = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const value = await transport.rpc.access.billing.getSubscription.query(
        undefined,
        { signal },
      );
      const previous = queries.getQueryData<{ status: string }>(key);
      if (!signal.aborted && previous && previous.status !== value.status)
        onStatusChange?.();
      return value;
    },
    staleTime: 0,
    meta: { errorTitle: "Couldn’t refresh subscription" },
  });
  const refetch = subscription.refetch;
  useEffect(() => {
    const refresh = () => {
      void queries.invalidateQueries(
        { queryKey: ["billing", user?.id] },
        { cancelRefetch: false },
      );
    };
    const unsubscribe = host.onBillingReturn(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [host, queries, user?.id]);
  useEffect(() => {
    const state = generation.current;
    return () => {
      state.revision++;
    };
  }, []);
  const open = useMutation({
    onMutate: () => generation.current.revision,
    mutationFn: async (action: BillingAction) => {
      const started = generation.current.revision;
      const result =
        action.kind === "checkout"
          ? await transport.rpc.access.billing.createCheckout.mutate({
              planId: cloudPlan.id,
              interval: action.interval,
            })
          : await transport.rpc.access.billing.createPortal.mutate();
      if (started === generation.current.revision)
        await host.openBilling(result.url);
    },
    onError: (_error, _kind, revision) => {
      if (revision === generation.current.revision) void refetch();
    },
    retry: false,
    gcTime: 0,
    meta: { errorTitle: "Couldn’t open billing" },
  });
  return { subscription, open };
}
