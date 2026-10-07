// Purpose: Present subscription facts and hosted billing actions using shared Settings and UI controls.
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@openchart/app/components/ui/badge";
import { Button } from "@openchart/app/components/ui/button";
import { Card, CardItem } from "@openchart/app/components/ui/settings/card";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  offersSubscription,
  useSubscription,
} from "@openchart/app/features/billing/api/use-subscription";
import { cloudPlan } from "@openchart/app/features/billing/cloud-plan";
import { SubscriptionPlanCard } from "./subscription-plan-card";
import { Invitations } from "./invitations";

const labels = {
  trialing: "Free trial",
  active: "Active",
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

/** Shows the signed-in account's facts. Cloud alone decides trial eligibility and data access. @example <Subscription transport={transport} /> */
export function Subscription(props: {
  transport: AppTransport;
  onStatusChange?: () => void;
  onAccessChange?: () => void;
}) {
  return (
    <div className="w-full max-w-3xl space-y-8">
      <SubscriptionDetails {...props} />
      <Invitations
        transport={props.transport}
        onAccessChange={props.onAccessChange}
      />
    </div>
  );
}

function SubscriptionDetails({
  transport,
  onStatusChange,
}: {
  transport: AppTransport;
  onStatusChange?: () => void;
}) {
  const { subscription, open } = useSubscription(transport, onStatusChange);
  const value = subscription.data;
  const refresh = (
    <Button
      variant="outline"
      disabled={subscription.isFetching}
      onClick={() => {
        void subscription.refetch();
      }}
    >
      <RefreshCw className="size-4" />
      {subscription.isFetching ? "Refreshing…" : "Refresh"}
    </Button>
  );
  const readError = subscription.isError ? (
    <p role="status" className="py-3 text-sm text-muted-foreground">
      {value
        ? "Subscription details may be out of date."
        : "Subscription details are unavailable."}{" "}
      Refresh to try again.
    </p>
  ) : null;

  if (!value) {
    return (
      <Card title={cloudPlan.name}>
        {subscription.isPending && <p role="status">Loading subscription…</p>}
        {readError}
        {subscription.isError && refresh}
      </Card>
    );
  }

  if (offersSubscription(value)) {
    return (
      <div className="w-full max-w-3xl">
        <SubscriptionPlanCard
          onSubscribe={(interval) =>
            open.mutate({ kind: "checkout", interval })
          }
          pending={open.isPending}
          disabled={subscription.isError}
        />
        {readError}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {value.status !== "none" && (
            <span className="mr-auto text-xs text-muted-foreground">
              {labels[value.status]} · Billing period end:{" "}
              {date(value.cancelAt ?? value.currentPeriodEnd)}
            </span>
          )}
          {refresh}
        </div>
      </div>
    );
  }

  const ended = value.cancelAtPeriodEnd || value.cancelAt !== null;
  const yearly = value.interval === "year";
  return (
    <Card title={cloudPlan.name}>
      <CardItem
        title={`$${cloudPlan.prices[value.interval]} USD / ${value.interval}`}
        description={`30-day free trial for eligible accounts, then billed ${yearly ? "yearly" : "monthly"}. Taxes may apply. Cancel anytime.`}
      />
      <CardItem
        title="Status"
        actions={<Badge variant="secondary">{labels[value.status]}</Badge>}
      />
      <CardItem
        title={
          ended
            ? "Scheduled to end"
            : value.status === "trialing"
              ? "Trial ends"
              : value.status === "active"
                ? "Next renewal"
                : "Billing period ends"
        }
        description={
          ended && (value.status === "trialing" || value.status === "active")
            ? "Your subscription will not renew. You can manage it in the billing portal."
            : undefined
        }
        actions={
          <span className="text-foreground">
            {date(value.cancelAt ?? value.currentPeriodEnd)}
          </span>
        }
      />
      {readError}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          disabled={open.isPending || subscription.isError}
          onClick={() => open.mutate({ kind: "portal" })}
        >
          {open.isPending ? "Opening…" : "Manage subscription"}
          <ExternalLink className="size-4" />
        </Button>
        {refresh}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Billing opens securely in your browser. Return here to see your updated
        subscription.
      </p>
    </Card>
  );
}
