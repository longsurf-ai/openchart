// Purpose: Snapshots of nested Windows and POSIX source trees share portable entry/import identities.
import { posix, win32 } from "node:path";
import { Schema } from "effect";
import { SnapshotSources } from "@openchart/tea";
import { compileToProgram, Errors } from "tea/compiler";
import { expect, test } from "vitest";
import { snapshotSources } from "./snapshot";

test.each([
  { name: "Windows", root: "C:\\Workspace", paths: win32 },
  { name: "POSIX", root: "/workspace", paths: posix },
])(
  "$name nested entry and imports compile from portable snapshot keys",
  ({ root, paths }) => {
    const entry = "studies/main.tea";
    const expected = {
      [entry]:
        'import ./lib/scale\nimport ../shared/limit\nemit "value" limit.cap(scale.twice(close))\n',
      "studies/lib/scale.tea": 'library("scale")\nexport twice(x) => x * 2\n',
      "shared/limit.tea":
        'library("limit")\nexport cap(x) => math.min(x, 100.0)\n',
    };
    const absolute = Object.fromEntries(
      Object.entries(expected).map(([filename, text]) => [
        paths.join(root, filename),
        text,
      ]),
    );
    const snapshot = Schema.decodeUnknownSync(SnapshotSources)({
      entry,
      sources: snapshotSources(root, absolute, paths),
    });
    expect(snapshot.sources).toEqual(expected);
    const errors = new Errors();
    const compiled = compileToProgram(
      [
        {
          filename: entry,
          source: snapshot.sources[entry]!,
          imports: snapshot.sources,
        },
      ],
      errors,
    );
    expect(errors.flushErrors()).toEqual([]);
    expect(compiled).toBeDefined();
  },
);

test("POSIX filenames containing backslashes are preserved rather than rewritten into directories", () => {
  expect(
    snapshotSources(
      "/workspace",
      { "/workspace/name\\part.tea": "source" },
      posix,
    ),
  ).toEqual({ "name\\part.tea": "source" });
});
