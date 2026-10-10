import { describe, expect, it } from "vitest";
import {
  assertBuildHost,
  parseTarget,
  releaseRoot,
  targets,
  updateFeedUrl,
} from "./targets";

describe("desktop release targets", () => {
  it.each(targets)("routes %s using the running binary", (target) => {
    const [platform, arch] = target.split("-");
    expect(updateFeedUrl(releaseRoot, platform!, arch!)).toBe(
      `${releaseRoot}/${platform}/${arch}`,
    );
    expect(parseTarget(target)).toBe(target);
  });
  it("preserves the installed ARM feed and removes trailing slashes", () => {
    expect(updateFeedUrl(`${releaseRoot}/`, "darwin", "arm64")).toBe(
      "https://downloads.longsurf.ai/openchart/darwin/arm64",
    );
  });
  it("disables missing feeds and unsupported architectures", () => {
    expect(updateFeedUrl(undefined, "win32", "x64")).toBeUndefined();
    expect(updateFeedUrl("", "darwin", "arm64")).toBeUndefined();
    expect(updateFeedUrl(releaseRoot, "linux", "x64")).toBeUndefined();
    expect(updateFeedUrl(releaseRoot, "win32", "arm64")).toBeUndefined();
  });
  it.each([
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/?x=1",
    "https://example.com/#feed",
  ])("rejects unsafe root %s", (root) => {
    expect(() => updateFeedUrl(root, "win32", "x64")).toThrow();
  });
  it("rejects unsupported builds and cross-OS installer construction", () => {
    expect(() => parseTarget("win32-arm64")).toThrow();
    expect(() => assertBuildHost("win32-x64", "darwin")).toThrow();
    expect(() => assertBuildHost("darwin-x64", "darwin")).not.toThrow();
    expect(() => assertBuildHost("darwin-arm64", "darwin")).not.toThrow();
    expect(() => assertBuildHost("win32-x64", "win32")).not.toThrow();
  });
});
