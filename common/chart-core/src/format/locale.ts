// Purpose: Locale namespace — locale-aware number, price, volume, and date/time formatting with Zod-validated options
// Module:  @openchart/chart-core / format

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace Locale {
  export const Options = z.object({
    locale: z.string().default("en-US"),
    dateFormat: z.string().default("MMM d, yyyy"),
    timeFormat: z.string().default("HH:mm"),
    priceFormatter: z.custom<(value: number) => string>().optional(),
    percentFormatter: z.custom<(value: number) => string>().optional(),
  });
  export type Options = z.infer<typeof Options>;

  let current: Options = Options.parse({});

  export function set(options: Partial<Options>): void {
    current = Options.parse({ ...current, ...options });
  }

  export function get(): Options {
    return current;
  }

  export function price(value: number, precision = 2): string {
    if (current.priceFormatter) {
      return current.priceFormatter(value);
    }
    return value.toLocaleString(current.locale, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  export function percent(value: number, precision = 2): string {
    if (current.percentFormatter) {
      return current.percentFormatter(value);
    }
    const sign = value >= 0 ? "+" : "";
    return (
      sign +
      value.toLocaleString(current.locale, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }) +
      "%"
    );
  }

  export function compact(value: number): string {
    const absValue = Math.abs(value);
    const sign = value < 0 ? "-" : "";

    if (absValue >= 1e9) {
      const formatted = (absValue / 1e9).toLocaleString(current.locale, {
        minimumFractionDigits: absValue >= 10e9 ? 1 : 2,
        maximumFractionDigits: absValue >= 10e9 ? 1 : 2,
      });
      return sign + formatted + "B";
    }
    if (absValue >= 1e6) {
      const formatted = (absValue / 1e6).toLocaleString(current.locale, {
        minimumFractionDigits: absValue >= 10e6 ? 1 : 2,
        maximumFractionDigits: absValue >= 10e6 ? 1 : 2,
      });
      return sign + formatted + "M";
    }
    if (absValue >= 1e3) {
      const formatted = (absValue / 1e3).toLocaleString(current.locale, {
        minimumFractionDigits: absValue >= 10e3 ? 1 : 2,
        maximumFractionDigits: absValue >= 10e3 ? 1 : 2,
      });
      return sign + formatted + "K";
    }
    if (absValue > 0 && absValue < 1) {
      const precision = absValue >= 0.01 ? 4 : absValue >= 0.0001 ? 6 : 8;
      return value.toLocaleString(current.locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: precision,
      });
    }
    return value.toLocaleString(current.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  export function date(timestamp: number | Date): string {
    const d =
      timestamp instanceof Date ? timestamp : new Date(timestamp * 1000);
    return d.toLocaleDateString(current.locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  export function time(timestamp: number | Date): string {
    const d =
      timestamp instanceof Date ? timestamp : new Date(timestamp * 1000);
    return d.toLocaleTimeString(current.locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  export function datetime(timestamp: number | Date): string {
    const d =
      timestamp instanceof Date ? timestamp : new Date(timestamp * 1000);
    return d.toLocaleString(current.locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  export function volume(value: number): string {
    const absValue = Math.abs(value);
    const sign = value < 0 ? "-" : "";

    if (absValue >= 1e9) {
      const formatted = (absValue / 1e9).toLocaleString(current.locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      return sign + formatted + "B";
    }
    if (absValue >= 1e6) {
      const formatted = (absValue / 1e6).toLocaleString(current.locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      return sign + formatted + "M";
    }
    if (absValue >= 1e3) {
      const formatted = (absValue / 1e3).toLocaleString(current.locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      return sign + formatted + "K";
    }
    return value.toLocaleString(current.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
}
