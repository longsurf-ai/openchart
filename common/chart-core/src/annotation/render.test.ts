// Purpose: Tests runtime-only annotation canvas paint projections.
// Module:  @openchart/chart-core / annotation

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annotationLabelMarqueeOffset,
  annotationSourceBadgeImagesReady,
  preloadAnnotationSourceBadgeImages,
} from "./render";

describe("annotationLabelMarqueeOffset", () => {
  it("moves at the semantic-column marquee speed and loops seamlessly", () => {
    expect(
      annotationLabelMarqueeOffset({ elapsedMs: 1_000, loopWidth: 100 }),
    ).toBe(-36);
    expect(
      annotationLabelMarqueeOffset({ elapsedMs: 3_000, loopWidth: 100 }),
    ).toBe(-8);
  });

  it("keeps invalid loop widths stationary", () => {
    expect(
      annotationLabelMarqueeOffset({ elapsedMs: 1_000, loopWidth: 0 }),
    ).toBe(0);
  });
});

describe("annotation source badge image readiness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports logo-backed badges as incomplete until the shared image cache settles", () => {
    const images: Array<{
      onload: (() => void) | null;
      onerror: (() => void) | null;
    }> = [];
    class FakeImage {
      crossOrigin = "";
      decoding = "";
      complete = false;
      naturalWidth = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        images.push(this);
      }

      set src(_value: string) {}
    }
    vi.stubGlobal("Image", FakeImage);

    const badges = [{ logoUrl: "/logos/source-ready.svg" }];
    const listener = vi.fn();

    preloadAnnotationSourceBadgeImages(badges, listener);
    expect(annotationSourceBadgeImagesReady(badges)).toBe(false);

    images[0]!.onload?.();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(annotationSourceBadgeImagesReady(badges)).toBe(true);
  });
});
