// Purpose: Tests annotation appearance rules shared by canvas layout and paint.
// Module:  @openchart/chart-core / annotation

import { describe, expect, it } from "vitest";
import { sourceBadgePlateColor } from "./appearance";

const companyBadge = {
  id: "company_document_googl_q4",
  label: "ALPHABET INC",
  logoUrl: "/assets/logos/v1/ticker?key=GOOGL&size=44",
};

describe("sourceBadgePlateColor", () => {
  it("preserves transparent pixels when a source logo has loaded", () => {
    expect(
      sourceBadgePlateColor({ badge: companyBadge, hasLoadedLogo: true }),
    ).toBeNull();
  });

  it("uses the deterministic color while the source logo is unavailable", () => {
    expect(
      sourceBadgePlateColor({ badge: companyBadge, hasLoadedLogo: false }),
    ).not.toBeNull();
  });

  it("keeps an explicitly requested logo plate after the logo loads", () => {
    expect(
      sourceBadgePlateColor({
        badge: { ...companyBadge, color: "#ffffff" },
        hasLoadedLogo: true,
      }),
    ).toBe("#ffffff");
  });
});
