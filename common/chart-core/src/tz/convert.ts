// Purpose: Convert UTC timestamps to target timezones and compute timezone offsets
// Module:  @openchart/chart-core / tz

import * as Tz from "./types";

export function fromUTC(time: number, target: Tz.Name): number {
  if (target === Tz.UTC) return time;
  if (target === Tz.LOCAL) {
    const date = new Date(time * 1000);
    const offset = date.getTimezoneOffset() * 60;
    return time - offset;
  }

  const date = new Date(time * 1000);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: target,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };

  const parts = new Intl.DateTimeFormat("en-US", opts).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";

  const year = parseInt(get("year"));
  const month = parseInt(get("month")) - 1;
  const day = parseInt(get("day"));
  const hour = parseInt(get("hour"));
  const minute = parseInt(get("minute"));
  const second = parseInt(get("second"));

  const targetDate = new Date(Date.UTC(year, month, day, hour, minute, second));
  return Math.floor(targetDate.getTime() / 1000);
}

export function offset(time: number, tz: Tz.Name): number {
  if (tz === Tz.UTC) return 0;

  const utcTime = time;
  const targetTime = fromUTC(time, tz);
  return targetTime - utcTime;
}
