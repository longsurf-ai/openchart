// Purpose: Keep desktop release targets and update routing consistent across the host and release tools.

/** Supported public release targets; development may still run on another host. */
export const targets = ["darwin-arm64", "darwin-x64", "win32-x64"] as const;
export type DesktopTarget = (typeof targets)[number];
/** Existing installed Apple Silicon clients retain this feed root. */
export const releaseRoot = "https://downloads.longsurf.ai/openchart";

/** Parses a release target without I/O; unsupported values throw before building. @example parseTarget('darwin-x64'); */
export function parseTarget(value: string): DesktopTarget {
  if (!targets.includes(value as DesktopTarget))
    throw new Error(`Unsupported desktop target: ${value}`);
  return value as DesktopTarget;
}

/** Returns the Electron platform for a validated target. @example targetPlatform('win32-x64'); */
export function targetPlatform(target: DesktopTarget): "darwin" | "win32" {
  return target.startsWith("darwin-") ? "darwin" : "win32";
}

/** Returns the executable architecture, independent of the build host. @example targetArch('darwin-x64'); */
export function targetArch(target: DesktopTarget): "arm64" | "x64" {
  return target === "darwin-arm64" ? "arm64" : "x64";
}

/** Requires the native packaging OS; both Mac architectures can build on either Mac. Throws before I/O. @example assertBuildHost('darwin-x64', 'darwin'); */
export function assertBuildHost(
  target: DesktopTarget,
  platform: NodeJS.Platform = process.platform,
): void {
  if (targetPlatform(target) !== platform)
    throw new Error(
      `Building ${target} requires a ${targetPlatform(target)} host`,
    );
}

/**
 * Selects this running binary's feed, preserving the existing ARM Mac URL.
 * Missing roots and unsupported targets disable updates. Invalid roots throw;
 * no network or lifecycle is owned here. Roots cannot contain query or hash data.
 * @example updateFeedUrl(releaseRoot, 'darwin', 'x64');
 */
export function updateFeedUrl(
  root: string | undefined,
  platform: string,
  arch: string,
): string | undefined {
  if (!root || !targets.includes(`${platform}-${arch}` as DesktopTarget))
    return undefined;
  const url = new URL(root);
  if (
    url.protocol !== "https:" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "Desktop update roots require HTTPS without credentials, query, or fragment",
    );
  return `${root.replace(/\/+$/, "")}/${platform}/${arch}`;
}
