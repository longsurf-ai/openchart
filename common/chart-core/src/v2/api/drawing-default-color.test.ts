// Purpose: Tests for theme-aware drawing default color resolution
// Module:  @openchart/chart-core / v2 / api

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDrawingDefaultColor } from "./drawing-default-color";

function installTheme(vars: Record<string, string>) {
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) => vars[name] ?? "",
  }));
}

describe("resolveDrawingDefaultColor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses white on dark chart themes", () => {
    installTheme({
      "--chart-bg": "225 10% 7%",
    });

    expect(
      resolveDrawingDefaultColor({
        layout: {
          background: "var(--chart-bg)",
          textColor: "var(--chart-text)",
        },
      }),
    ).toBe("#ffffff");
  });

  it("uses black on light chart themes", () => {
    installTheme({
      "--chart-bg": "216 24% 98%",
    });

    expect(
      resolveDrawingDefaultColor({
        layout: {
          background: "var(--chart-bg)",
          textColor: "var(--chart-text)",
        },
      }),
    ).toBe("#000000");
  });

  it("ignores primary color even when the token is available", () => {
    installTheme({
      "--chart-bg": "0 0% 8%",
      "--primary": "233 55% 62%",
    });

    expect(
      resolveDrawingDefaultColor({
        layout: {
          background: "var(--chart-bg)",
          textColor: "var(--chart-text)",
        },
      }),
    ).toBe("#ffffff");
  });
});
