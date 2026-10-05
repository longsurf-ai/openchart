// Purpose: A self-contained Cloud offer for Settings and the upgrade dialogs.
import { ArrowRight } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@openchart/app/components/ui/badge";
import { Button } from "@openchart/app/components/ui/button";
import { Switch } from "@openchart/app/components/ui/switch";
import openSea from "@openchart/app/features/billing/assets/open-sea.png";
import {
  cloudPlan,
  type BillingInterval,
} from "@openchart/app/features/billing/cloud-plan";
import "./subscription-plan-card.css";

/** Live capture today, rounded down; recount before raising these numbers. */
const coverage = [
  ["6,600+", "US stocks"],
  ["5,600+", "ETFs"],
  ["600+", "Crypto pairs"],
] as const;

/**
 * Lets the plan card be the whole Dialog surface. Width comes from the shared
 * `size="lg"` preset and height from the card's content; the Dialog scrolls
 * when a short window cannot fit it.
 * @example <DialogContent size="lg" className={planDialogClassName}>…</DialogContent>
 */
export const planDialogClassName =
  "plan-dialog gap-0 rounded-[20px] border-0 bg-transparent p-0";

/**
 * Presents the Cloud plan and owns only the unsubmitted billing-period choice.
 * The host owns checkout, pending/error state and subscription eligibility;
 * this card requires no router, transport or Settings context. A compact
 * content column sits in the left 58% over a light wash, leaving the sailboat
 * clear on the right; narrow cards stack it over a full wash.
 * @example <SubscriptionPlanCard onSubscribe={(interval) => checkout(interval)} />
 */
export function SubscriptionPlanCard({
  onSubscribe,
  pending = false,
  disabled = false,
}: {
  onSubscribe: (interval: BillingInterval) => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  const [yearly, setYearly] = useState(true);
  const interval = yearly ? "year" : "month";
  const id = useId();

  return (
    <article
      aria-labelledby={`${id}-title`}
      className="plan-ink relative isolate w-full overflow-hidden rounded-[20px] bg-sky-100 [container-type:inline-size]"
    >
      <img
        src={openSea}
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover object-[80%_center]"
      />
      <div className="plan-wash pointer-events-none absolute inset-0" />
      <div className="relative flex min-w-0 flex-col p-6 [@container(min-width:36rem)]:w-[58%] [@container(min-width:36rem)]:p-10">
        {/* The title sets the column's width; the rest ignores its own width
            ([contain:inline-size]) and fills that column, so every right edge
            lines up with the title. */}
        <div className="flex w-fit max-w-full flex-col">
          <p className="plan-text font-semibold">{cloudPlan.name}</p>
          <h2 id={`${id}-title`} className="plan-display mt-8 text-balance">
            The entire US market, live.
          </h2>
          <div className="flex flex-col [contain:inline-size]">
            <p className="plan-text plan-ink-muted mt-2 text-pretty">
              Prices from every US exchange, streamed in real time with no
              throttling.
            </p>
            <dl className="mt-10 grid grid-cols-3 divide-x divide-[color:color-mix(in_srgb,var(--plan-ink)_14%,transparent)]">
              {coverage.map(([count, label]) => (
                <div
                  key={label}
                  className="flex min-w-0 flex-col-reverse px-4 first:pl-0 last:pr-0"
                >
                  <dt className="plan-caption plan-ink-muted">{label}</dt>
                  <dd className="plan-figure">{count}</dd>
                </div>
              ))}
            </dl>
            <div className="plan-text mt-10 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className={yearly ? "plan-ink-muted" : "font-semibold"}>
                Monthly
              </span>
              <Switch
                id={`${id}-yearly`}
                aria-label="Yearly billing"
                checked={yearly}
                onCheckedChange={setYearly}
                disabled={disabled || pending}
                className="focus-visible:ring-slate-600/50 data-[checked]:bg-[color:var(--plan-ink)] data-[unchecked]:bg-slate-400 dark:data-[unchecked]:bg-slate-400 [&_[data-slot=switch-thumb]]:bg-white dark:[&_[data-slot=switch-thumb]]:bg-white"
              />
              <label
                htmlFor={`${id}-yearly`}
                className={yearly ? "font-semibold" : "plan-ink-muted"}
              >
                Yearly<span className="sr-only"> billing</span>
              </label>
              <Badge
                variant="secondary"
                className="plan-text border-transparent bg-white/70 px-3 font-normal text-[color:var(--plan-accent)] hover:bg-white/70"
              >
                Save ${cloudPlan.prices.month * 12 - cloudPlan.prices.year} /
                year
              </Badge>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4">
              <p
                className="flex items-baseline gap-2"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="plan-display tabular-nums">
                  ${cloudPlan.prices[interval]}
                </span>
                <span className="plan-caption plan-ink-muted">
                  / {interval}
                </span>
              </p>
              <Button
                className="plan-text h-12 min-w-40 flex-1 rounded-md bg-[color:var(--plan-ink)] px-6 font-semibold text-white hover:bg-[color:var(--plan-ink)] hover:brightness-125 focus-visible:ring-slate-600/50"
                disabled={disabled || pending}
                onClick={() => onSubscribe(interval)}
              >
                {pending ? "Opening…" : "Subscribe"}
                {!pending && (
                  <ArrowRight aria-hidden="true" className="size-4" />
                )}
              </Button>
            </div>
            <p className="plan-caption plan-ink-muted mt-4">
              30-day free trial for eligible accounts. Taxes may apply. Cancel
              anytime.
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}
