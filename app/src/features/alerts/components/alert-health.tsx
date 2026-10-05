// Purpose: Present one alert's monitoring health: a status icon and the persistent page banner.
import type { ReactNode } from "react";
import {
  BellIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PauseIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { StatusBanner } from "@openchart/app/components/ui/status-banner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@openchart/app/components/ui/popover";
import { cn } from "@openchart/app/utils/cn";
import type { AlertHealth } from "@openchart/app/features/alerts/api/monitoring";

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Short sentence for tooltips and accessible names. @example healthSummary({state: "paused"}); */
export function healthSummary(health: AlertHealth): string {
  switch (health.state) {
    case "paused":
      return "Paused";
    case "healthy":
      return "Monitoring";
    case "unknown":
      return health.reason.code === "starting" ||
        health.reason.code === "checking"
        ? health.reason.message
        : `Can't confirm monitoring: ${health.reason.message}`;
    case "degraded":
      return `Data may be delayed: ${health.reason.message}`;
    case "failed":
      return `Not monitoring: ${health.reason.message}`;
  }
}

/** The glyph for one health state; color carries severity, the label carries meaning. @example <AlertHealthIcon health={health} /> */
export function AlertHealthIcon({
  health,
  className,
}: {
  health: AlertHealth;
  className?: string;
}) {
  const icon = cn("size-4 shrink-0", className);
  switch (health.state) {
    case "paused":
      return <PauseIcon aria-hidden="true" className={icon} />;
    case "healthy":
      return <BellIcon aria-hidden="true" className={icon} />;
    case "unknown":
      return (
        <LoaderCircleIcon
          aria-hidden="true"
          className={cn(icon, "motion-safe:animate-spin")}
        />
      );
    case "degraded":
      return (
        <TriangleAlertIcon
          aria-hidden="true"
          className={cn(icon, "text-indicator-amber")}
        />
      );
    case "failed":
      return (
        <CircleAlertIcon
          aria-hidden="true"
          className={cn(icon, "text-destructive")}
        />
      );
  }
}

const headlines = {
  unknown: "Can't confirm this alert is monitoring",
  degraded: "Data for this alert may be delayed",
  failed: "This alert isn't monitoring",
} as const;

/**
 * One persistent line while an enabled rule is not verifiably monitoring:
 * headline, reason and start time. When there are details (unhealthy checks,
 * last success, retry behavior), the line is a button opening them in a
 * popover, so mouse, keyboard and touch all reach them. Renders nothing when
 * paused, healthy, or still checking on first load, so no banner means
 * monitoring holds. A polite status region: it never interrupts.
 * @example <AlertMonitoringBanner health={health} action={<Button size="xs">Pause</Button>} />
 */
export function AlertMonitoringBanner({
  health,
  action,
}: {
  health: AlertHealth;
  action?: ReactNode;
}) {
  if (
    health.state === "paused" ||
    health.state === "healthy" ||
    health.reason.code === "checking"
  )
    return null;
  const headline =
    health.reason.code === "starting"
      ? "Starting monitoring…"
      : headlines[health.state];
  const problems = health.checks.filter(
    (check) => check.health.state !== "healthy",
  );
  const line = (
    <>
      {headline}
      <span className="font-normal">
        {` · ${health.reason.message.replace(/\.$/, "")}`}
        {health.since === undefined
          ? null
          : ` · since ${clock.format(health.since)}`}
        {health.retrying ? " · retrying" : null}
      </span>
    </>
  );
  return (
    <StatusBanner
      tone={
        health.state === "failed"
          ? "danger"
          : health.state === "degraded"
            ? "warning"
            : "neutral"
      }
      icon={<AlertHealthIcon health={health} />}
      action={action}
    >
      {problems.length > 0 || health.state === "failed" ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="block w-full truncate rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {line}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="start"
            className="w-auto max-w-sm p-3 text-sm"
          >
            <ul className="grid gap-1">
              {problems.map((check) => (
                <li key={check.label}>
                  {check.label}
                  {check.health.state === "healthy"
                    ? null
                    : `: ${check.health.reason.message}`}
                  {check.lastOkAt === null
                    ? null
                    : ` Last OK ${clock.format(check.lastOkAt)}.`}
                </li>
              ))}
              {health.retrying ? (
                <li className="text-muted-foreground">
                  Retrying automatically. Conditions during this time may be
                  missed.
                </li>
              ) : null}
            </ul>
          </PopoverContent>
        </Popover>
      ) : (
        <span className="block truncate">{line}</span>
      )}
    </StatusBanner>
  );
}
