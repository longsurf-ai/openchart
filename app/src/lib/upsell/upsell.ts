// Purpose: Collect the moments when OpenChart Cloud would help and pace how often the offer appears.
import type { FeedError } from "@openchart/feed";
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

const Saved = z.object({
  /** When the offer last appeared, in epoch milliseconds. */
  lastShownAt: z.number().int().nonnegative().optional(),
});

type Upsell = z.infer<typeof Saved> & {
  /** A reported moment the offer card has not decided on yet. */
  readonly pending: boolean;
  /** Whether the offer card is showing. */
  readonly open: boolean;
  /** Records a moment if Cloud would solve the failure; anything else is ignored. */
  report: (failure: FeedError) => void;
  /** Shows the pending moment unless the cooldown is running, which drops it. */
  present: (now: number) => void;
  /** Drops the pending moment, for example when the account is not offered Cloud. */
  discard: () => void;
  /** Hides the card; the cooldown already started when it appeared. */
  close: () => void;
};

/**
 * Device-local offer pacing; only `lastShownAt` persists. Features call
 * `report`; the billing offer card owns eligibility, `present` and `close`.
 * @example useUpsell.getState().report(failure);
 */
export const useUpsell = create<Upsell>()(
  persist(
    (set) => ({
      pending: false,
      open: false,
      lastShownAt: undefined,
      report: (failure) => {
        if (cloudSolves(failure)) set({ pending: true });
      },
      present: (now) =>
        set(({ pending, lastShownAt }) => {
          if (!pending) return {};
          if (lastShownAt !== undefined && now - lastShownAt < offerCooldownMs)
            return { pending: false };
          return { pending: false, open: true, lastShownAt: now };
        }),
      discard: () => set({ pending: false }),
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
