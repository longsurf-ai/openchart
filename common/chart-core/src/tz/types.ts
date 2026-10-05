// Purpose: Timezone type definitions, constants, parsing, validation, and common timezone list
// Module:  @openchart/chart-core / tz

export type Name = string;

export type Info = {
  name: Name;
  label: string;
};

export const UTC = "UTC";
export const LOCAL = "local";

export function parse(s: string): Info {
  if (s === LOCAL) return { name: LOCAL, label: "Local" };
  if (s === UTC) return { name: UTC, label: "UTC" };

  const parts = s.split("/");
  const label = parts[parts.length - 1]?.replace(/_/g, " ") ?? s;
  return { name: s, label };
}

export function validate(name: Name): boolean {
  if (name === LOCAL || name === UTC) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function common(): Info[] {
  return [
    { name: LOCAL, label: "Local" },
    { name: UTC, label: "UTC" },
    { name: "America/New_York", label: "New York" },
    { name: "America/Chicago", label: "Chicago" },
    { name: "America/Los_Angeles", label: "Los Angeles" },
    { name: "Europe/London", label: "London" },
    { name: "Europe/Paris", label: "Paris" },
    { name: "Asia/Tokyo", label: "Tokyo" },
    { name: "Asia/Shanghai", label: "Shanghai" },
    { name: "Asia/Dubai", label: "Dubai" },
    { name: "Australia/Sydney", label: "Sydney" },
  ];
}
