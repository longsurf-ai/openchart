// Purpose: Derive a chart session badge from venue days and the coverage selector.
import type { Chart } from "@openchart/chart-core/v2";
import {
  coveredSessionTypes,
  type SessionType,
  type TradingDay,
  type TradingSession,
} from "@openchart/market";

const DAY_MS = 86_400_000;

/** Open, closed until the next covered session, or no sessions in the calendar. */
type SessionClockStatus =
  | {
      readonly kind: "open";
      readonly session: TradingSession;
      readonly remainingMs: number;
    }
  | {
      readonly kind: "closed";
      readonly next: TradingSession | undefined;
      readonly remainingMs: number | undefined;
    }
  | { readonly kind: "empty" };

/**
 * UTC-day aligned calendar window around `now`: two days back and twelve ahead.
 * The bounds stay fixed for a UTC day so live ticks do not refetch.
 * @example sessionClockWindow(Date.UTC(2026, 9, 15, 16));
 */
export function sessionClockWindow(now: number): {
  start: number;
  end: number;
} {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return { start: today - 2 * DAY_MS, end: today + 12 * DAY_MS };
}

/**
 * Covered sessions at `now` for the chart's session selector.
 * @example sessionClockStatus({ days, now: Date.now(), coverage: "regular" });
 */
export function sessionClockStatus({
  days,
  now,
  coverage,
}: {
  readonly days: readonly TradingDay[];
  readonly now: number;
  readonly coverage: SessionType;
}): SessionClockStatus {
  const allowed = new Set(coveredSessionTypes(coverage));
  const sessions = days
    .flatMap((day) => day.sessions)
    .filter((session) => allowed.has(session.type))
    .sort((left, right) => left.start - right.start);
  if (!sessions.length) return { kind: "empty" };
  const open = sessions.find(
    (session) => session.start <= now && now < session.end,
  );
  if (open) {
    return {
      kind: "open",
      session: open,
      remainingMs: Math.max(0, open.end - now),
    };
  }
  const next = sessions.find((session) => session.start > now);
  return {
    kind: "closed",
    next,
    remainingMs: next ? Math.max(0, next.start - now) : undefined,
  };
}

/**
 * Badge fields for the core price-tag countdown. An empty calendar draws none.
 * An open session counts to its close; a closed one counts to the next open.
 * @example sessionInfo(sessionClockStatus({ days, now, coverage: "regular" }));
 */
export function sessionInfo(
  status: SessionClockStatus,
): Chart.SessionInfo | undefined {
  if (status.kind === "empty") return undefined;
  if (status.kind === "open") {
    const type = status.session.type;
    return {
      phase: type === "pre" || type === "post" ? type : "open",
      currentSessionOpenAt: status.session.start / 1000,
      nextCloseAt: status.session.end / 1000,
    };
  }
  return status.next
    ? { phase: "closed", nextOpenAt: status.next.start / 1000 }
    : { phase: "closed" };
}

/** A bar's start time (Unix milliseconds) and close. */
export type LatestBar = { readonly time: number; readonly close: number };

/**
 * Add core's secondary "Pre"/"Post" price tag to a pre/post badge, from the
 * latest 1m Extended bar. A bar that started before the current pre/post
 * session (a regular bar, or one from an earlier session) is not that
 * session's price, so the badge stays unchanged until the first trade. Other
 * phases and a missing bar also return `info` unchanged.
 * @example withExtendedPrice({ phase: "post", currentSessionOpenAt: 1_794_258_000 }, { time: 1_794_258_060_000, close: 350.2 });
 */
export function withExtendedPrice(
  info: Chart.SessionInfo | undefined,
  latest: LatestBar | undefined,
): Chart.SessionInfo | undefined {
  if (
    !info ||
    !latest ||
    (info.phase !== "pre" && info.phase !== "post") ||
    info.currentSessionOpenAt === undefined ||
    latest.time < info.currentSessionOpenAt * 1000
  )
    return info;
  return {
    ...info,
    extendedPrice: latest.close,
    extendedLabel: info.phase === "pre" ? "Pre" : "Post",
  };
}
