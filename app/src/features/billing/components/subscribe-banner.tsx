// Purpose: Offer Cloud subscriptions or a compact invitation shortcut in the sidebar.
import { Gift } from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@openchart/app/components/ui/dialog";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  offersSubscription,
  useSubscription,
} from "@openchart/app/features/billing/api/use-subscription";
import { cloudPlan } from "@openchart/app/features/billing/cloud-plan";
import {
  planDialogClassName,
  SubscriptionPlanCard,
} from "./subscription-plan-card";
import { useCloudAccess } from "@openchart/app/features/billing/api/use-referrals";

/** Confirmed subscribers see a compact invite shortcut; other eligible accounts see the
 * plan offer. The app owns invite navigation. A subscription closes the plan dialog.
 * @example <SubscribeBanner transport={transport} onInviteFriends={openSubscription} />
 */
export function SubscribeBanner({
  transport,
  onStatusChange,
  onInviteFriends,
}: {
  transport: AppTransport;
  onStatusChange?: () => void;
  onInviteFriends: () => void;
}) {
  const { subscription, open } = useSubscription(transport, onStatusChange);
  const access = useCloudAccess(transport);
  const until = access.data?.complimentaryAccessUntil;
  if (
    subscription.data?.status === "active" ||
    subscription.data?.status === "trialing"
  ) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="ml-2 h-7 w-fit gap-1.5 self-start rounded-full bg-[var(--invitation-lilac)] px-3 text-xs text-[var(--invitation-ink)] hover:bg-[var(--invitation-pink)]"
        onClick={onInviteFriends}
      >
        <Gift className="size-3.5" />
        Invite friends
      </Button>
    );
  }
  if (!subscription.data || !offersSubscription(subscription.data)) return null;
  return (
    <div className="flex flex-col gap-2">
      <Dialog>
        {/* The skewed backdrop slants the right edge; the trigger clips its left overhang. */}
        <DialogTrigger className="relative mx-2 overflow-hidden rounded-l-lg px-3 py-1.5 text-center text-white outline-none transition hover:brightness-110 focus-visible:brightness-110">
          <span className="absolute inset-0 origin-top -skew-x-12 rounded-r-lg bg-gradient-to-r from-sky-500 via-blue-600 to-fuchsia-500" />
          <span className="relative block text-base font-semibold leading-tight">
            Try Cloud free
          </span>
          <span className="relative block text-sm leading-tight text-white/90">
            30 days on us
          </span>
        </DialogTrigger>
        <DialogContent
          aria-describedby={undefined}
          size="lg"
          className={planDialogClassName}
        >
          <DialogTitle className="sr-only">{cloudPlan.name}</DialogTitle>
          <SubscriptionPlanCard
            onSubscribe={(interval) =>
              open.mutate({ kind: "checkout", interval })
            }
            pending={open.isPending}
            disabled={subscription.isError}
          />
        </DialogContent>
      </Dialog>
      {until && new Date(until).getTime() > Date.now() && (
        <p className="text-center text-xs text-muted-foreground">
          Free access until{" "}
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
            new Date(until),
          )}
        </p>
      )}
    </div>
  );
}
