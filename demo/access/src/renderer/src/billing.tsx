// Purpose: Display cloud subscription facts and refresh after hosted billing returns.
import { useEffect, useRef, type MutableRefObject } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { server } from "./server";

/** Account-scoped, ephemeral billing query prefix used for logout cleanup. */
export const billingKey = ["billing"] as const;
const labels = {
  none: "No subscription",
  active: "Active",
  trialing: "Trial",
  past_due: "Payment overdue",
  unpaid: "Unpaid",
  paused: "Paused",
  canceled: "Canceled",
  incomplete: "Payment incomplete",
  incomplete_expired: "Checkout expired",
};
const date = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );

/** Current account only; navigation never changes the displayed subscription. @example <BillingPanel userId={user.id} accountRevision={revision} /> */
export function BillingPanel({
  userId,
  accountRevision,
}: {
  userId: string;
  accountRevision: MutableRefObject<number>;
}) {
  const mounted = useRef(false);
  const revision = useRef(accountRevision.current);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    mounted.current && revision.current === accountRevision.current;
  const subscription = useQuery({
    queryKey: [...billingKey, userId, revision.current],
    queryFn: async ({ signal }) => {
      const value = await server.access.billing.getSubscription.query(
        undefined,
        { signal },
      );
      if (revision.current !== accountRevision.current)
        throw new Error("Your account changed. Please refresh.");
      return value;
    },
    retry: false,
    gcTime: 0,
  });
  const refetch = subscription.refetch;
  useEffect(() => {
    const refresh = () => {
      void refetch();
    };
    const unsubscribe = window.accessDemo.onBillingReturn(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [refetch]);
  const open = useMutation({
    mutationFn: async (kind: "checkout" | "portal") => {
      const result =
        kind === "checkout"
          ? await server.access.billing.createCheckout.mutate({
              planId: "openchart",
              interval: "month",
            })
          : await server.access.billing.createPortal.mutate();
      if (current()) await window.accessDemo.openBilling(result.url);
    },
    onError: () => {
      if (current()) void refetch();
    },
    retry: false,
    gcTime: 0,
  });
  const value = subscription.data;
  const canSubscribe =
    value && ["none", "canceled", "incomplete_expired"].includes(value.status);
  return (
    <section className="billing" aria-labelledby="billing-heading">
      <h2 id="billing-heading">Subscription</h2>
      {subscription.isPending && <p role="status">Loading subscription…</p>}
      {subscription.isError && <p role="alert">{subscription.error.message}</p>}
      {value && (
        <>
          <p className="subscription-status">{labels[value.status]}</p>
          {value.status !== "none" && (
            <>
              <p>
                OpenChart · {value.interval === "month" ? "Monthly" : "Yearly"}
              </p>
              <p className="hint">
                Current period: {date(value.currentPeriodStart)} –{" "}
                {date(value.currentPeriodEnd)}
              </p>
              {(value.cancelAtPeriodEnd || value.cancelAt) && (
                <p>
                  Scheduled to end{" "}
                  {date(value.cancelAt ?? value.currentPeriodEnd)}.
                </p>
              )}
            </>
          )}
        </>
      )}
      {open.isError && <p role="alert">{open.error.message}</p>}
      {open.isSuccess && (
        <p className="hint">
          Finish in your browser, then return here to refresh your subscription.
        </p>
      )}
      {canSubscribe && (
        <button
          disabled={open.isPending || subscription.isError}
          onClick={() => open.mutate("checkout")}
        >
          {open.isPending && open.variables === "checkout"
            ? "Opening checkout…"
            : "Subscribe to OpenChart monthly"}
        </button>
      )}
      {value && value.status !== "none" && (
        <button
          disabled={open.isPending || subscription.isError}
          onClick={() => open.mutate("portal")}
        >
          {open.isPending && open.variables === "portal"
            ? "Opening portal…"
            : "Manage subscription"}
        </button>
      )}
      <button
        className="secondary"
        disabled={subscription.isFetching}
        onClick={() => void refetch()}
      >
        {subscription.isFetching ? "Refreshing…" : "Refresh subscription"}
      </button>
    </section>
  );
}
