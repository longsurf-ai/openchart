// Purpose: Collect the moments when OpenChart Cloud would help and pace how often the offer appears.
import type { FeedError } from "@openchart/feed";
import type { AssetClass, ProviderId } from "@openchart/market";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** After the offer has shown, whatever the user chose, it stays away this long. */
export const offerCooldownMs = 3 * 24 * 60 * 60 * 1000;

/**
 * Whether OpenChart Cloud removes this Feed failure: a free source's limited
 * history or rate limit, or Cloud refusing access because the plan lapsed.
 * Other failures are not Cloud's to solve, so they never raise the offer.
 * @example cloudSolves(failure); // true for Yahoo Finance's HistoryUnavailable
 */
export function cloudSolves(failure: FeedError): boolean {
  const { reason } = failure;
  switch (reason._tag) {
    case "Feed.HistoryUnavailable":
    case "Feed.RateLimited":
      return reason.provider !== "openchart";
    case "Feed.AccessDenied":
      return reason.provider === "openchart";
    default:
      return false;
  }
}

/** A chart toolbar option menu: interval, session or price adjustment. */
export type ChartOption = "resolution" | "session" | "adjustment";

/** The chart a locked option belongs to. */
export type OptionChart = {
  readonly provider: ProviderId;
  readonly listingClass?: AssetClass;
};

/**
 * Whether OpenChart Cloud offers a chart option the chart's free source lacks.
 * Cloud serves every interval, session and adjustment. Crypto trades around the
 * clock without splits, so its session and adjustment options never raise the
 * offer. A chart already on Cloud never does.
 * @example cloudOffersOption("resolution", { provider }); // true off Cloud
 */
export function cloudOffersOption(
  option: ChartOption,
  chart: OptionChart,
): boolean {
  if (chart.provider === "openchart") return false;
  return option === "resolution" || chart.listingClass !== "crypto";
}

const Saved = z.object({
  /** When the offer last appeared, in epoch milliseconds. */
  lastShownAt: z.number().int().nonnegative().optional(),
});

/**
 * Why the offer is pending: a failure the user saw waits out the cooldown; a
 * locked option the user chose asked for the offer, so it shows every time.
 */
type Moment = "failure" | "request";

type Upsell = z.infer<typeof Saved> & {
  /** A reported moment the offer card has not decided on yet. */
  readonly pending: Moment | undefined;
  /** Whether the offer card is showing. */
  readonly open: boolean;
  /** Records a moment if Cloud would solve the failure; anything else is ignored. */
  report: (failure: FeedError) => void;
  /** Records the user asking for the offer; it skips the cooldown. */
  request: () => void;
  /** Shows the pending moment; a failure during the cooldown is dropped instead. */
  present: (now: number) => void;
  /** Drops the pending moment, for example when the account is not offered Cloud. */
  discard: () => void;
  /** Hides the card; the cooldown already started when it appeared. */
  close: () => void;
};

/**
 * Device-local offer pacing; only `lastShownAt` persists. Features call
 * `report` or `request`; the billing offer card owns eligibility, `present`
 * and `close`.
 * @example useUpsell.getState().report(failure);
 */
export const useUpsell = create<Upsell>()(
  persist(
    (set) => ({
      pending: undefined,
      open: false,
      lastShownAt: undefined,
      report: (failure) => {
        if (cloudSolves(failure)) set({ pending: "failure" });
      },
      request: () => set({ pending: "request" }),
      present: (now) =>
        set(({ pending, lastShownAt }) => {
          if (!pending) return {};
          const cooling =
            lastShownAt !== undefined && now - lastShownAt < offerCooldownMs;
          if (pending === "failure" && cooling) return { pending: undefined };
          return { pending: undefined, open: true, lastShownAt: now };
        }),
      discard: () => set({ pending: undefined }),
      close: () => set({ open: false }),
    }),
    {
      name: "local:upsell",
      version: 1,
      partialize: ({ lastShownAt }) => ({ lastShownAt }),
      merge: (saved, current) => {
        const parsed = Saved.safeParse(saved);
        return parsed.success ? { ...current, ...parsed.data } : current;
      },
    },
  ),
);

/**
 * Reports a Feed failure the user just saw; the offer card decides the rest.
 * @example useEffect(() => { if (failure?._tag === "FeedError") reportUpsell(failure); }, [failure]);
 */
export function reportUpsell(failure: FeedError): void {
  useUpsell.getState().report(failure);
}

/**
 * Reports a click on a chart option the current source lacks. Only options
 * Cloud offers raise the offer, and since the user asked, it skips the cooldown.
 * @example reportLockedOption("resolution", { provider });
 */
export function reportLockedOption(
  option: ChartOption,
  chart: OptionChart,
): void {
  if (cloudOffersOption(option, chart)) useUpsell.getState().request();
}
