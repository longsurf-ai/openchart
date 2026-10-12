// Purpose: Preserve compiled Workspace source keys as portable, relative snapshot paths.
import path from "node:path";

/**
 * Projects compiler-owned absolute filenames to snapshot keys using the host's
 * native path rules. Only native separators become `/`; a literal backslash in
 * a POSIX filename is preserved. The caller validates snapshot bounds and its
 * entry before persistence. This pure operation neither reads files nor retains
 * resources. `paths` permits callers/tests to describe another host's filenames.
 *
 * @example
 * snapshotSources(root, compiled.sources); // { "studies/main.tea": "..." }
 */
export function snapshotSources(
  root: string,
  sources: Readonly<Record<string, string>>,
  paths: Pick<typeof path, "relative" | "sep"> = path,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sources).map(([filename, text]) => [
      paths.relative(root, filename).split(paths.sep).join("/"),
      text,
    ]),
  );
}
