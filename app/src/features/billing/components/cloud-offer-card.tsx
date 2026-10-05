// Purpose: Offer OpenChart Cloud in one restrained corner card after a chart hits a limit Cloud removes.
import { ArrowRight, Cloud, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import {
  offersSubscription,
  useSubscription,
} from "@openchart/app/features/billing/api/use-subscription";
import { useCloudAccess } from "@openchart/app/features/billing/api/use-referrals";
import underSea from "@openchart/app/features/billing/assets/under-sea.webp";
import { cloudPlan } from "@openchart/app/features/billing/cloud-plan";
import { useUpsell } from "@openchart/app/lib/upsell/upsell";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  planDialogClassName,
  SubscriptionPlanCard,
} from "./subscription-plan-card";

/**
 * Shows the Cloud offer for a moment features reported to `lib/upsell`. Billing
 * reads mount only while a moment is pending or the card is open; `paused`
 * (onboarding, no signed-in account) drops moments without reading billing.
 * Explore Cloud opens the plan dialog; closing either one ends the offer.
 * @example <CloudOfferCard transport={transport} paused={touring} />
 */
export function CloudOfferCard({
  transport,
  paused,
}: {
  transport: AppTransport;
  paused: boolean;
}) {
  const pending = useUpsell((state) => state.pending);
  const open = useUpsell((state) => state.open);
  const discard = useUpsell((state) => state.discard);
  useEffect(() => {
    if (paused && pending) discard();
  }, [paused, pending, discard]);
  if (paused || (!pending && !open)) return null;
  return <Offer transport={transport} />;
}

/** Decides a pending moment once billing is known, then renders the card or the plan. */
function Offer({ transport }: { transport: AppTransport }) {
  const { subscription, open: checkout } = useSubscription(transport);
  const access = useCloudAccess(transport);
  const { pending, open, present, discard, close } = useUpsell();
  const [exploring, setExploring] = useState(false);
  const titleId = useId();
  // Only a confirmed account without Cloud access sees the offer; unknown waits.
  const eligible =
    subscription.data && access.data
      ? offersSubscription(subscription.data) && !access.data.canAccess
      : undefined;
  useEffect(() => {
    if (!pending || eligible === undefined) return;
    if (eligible) present(Date.now());
    else discard();
  }, [pending, eligible, present, discard]);
  if (!open) return null;
  if (exploring)
    return (
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          size="lg"
          className={planDialogClassName}
        >
          <DialogTitle className="sr-only">{cloudPlan.name}</DialogTitle>
          <SubscriptionPlanCard
            onSubscribe={(interval) =>
              checkout.mutate({ kind: "checkout", interval })
            }
            pending={checkout.isPending}
            disabled={subscription.isError}
          />
        </DialogContent>
      </Dialog>
    );
  return (
    <aside
      aria-labelledby={titleId}
      className="fixed bottom-4 right-4 z-50 w-80 overflow-hidden rounded-2xl text-white shadow-2xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-4"
    >
      <img
        src={underSea}
        alt=""
        className="absolute inset-0 size-full object-cover object-top"
      />
      {/* Fades the artwork into deep water so the white text stays readable. */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-sky-950/45 to-sky-950/90" />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Close"
        onClick={close}
        className="absolute right-3 top-3 z-10 size-8 rounded-full bg-white/80 text-slate-700 hover:bg-white"
      >
        <X />
      </Button>
      <div className="relative flex flex-col gap-2 px-5 pb-3 pt-28">
        <p className="flex items-center gap-2 text-sm text-white/90">
          <Cloud className="size-4" />
          {cloudPlan.name}
        </p>
        <h2 id={titleId} className="text-2xl font-semibold leading-tight">
          Keep your data flowing
        </h2>
        <p className="text-sm text-white/85">
          Explore higher quality market data
        </p>
        <Button
          onClick={() => setExploring(true)}
          className="mt-2 w-full rounded-full bg-white text-slate-900 hover:bg-white/90"
        >
          Explore Cloud
          <ArrowRight />
        </Button>
        <Button
          variant="link"
          onClick={close}
          className="text-white/85 hover:text-white"
        >
          Stay on limited data
        </Button>
      </div>
    </aside>
  );
}
