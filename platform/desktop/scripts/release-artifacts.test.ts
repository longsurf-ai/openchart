import { expect, it } from "vitest";
import { parseSquirrelReleases } from "./release-artifacts";

it("reads Squirrel's BOM-prefixed Windows feed without changing its filename", () => {
  expect(
    parseSquirrelReleases(
      `\uFEFF${"A".repeat(40)} OpenChart-0.1.14-full.nupkg 12345\r\n`,
    ),
  ).toEqual([
    { sha1: "a".repeat(40), name: "OpenChart-0.1.14-full.nupkg", size: 12345 },
  ]);
});

it.each([
  "",
  "\uFEFF\r\n",
  "not a release",
  `${"a".repeat(40)} ../outside.nupkg 1`,
  `${"a".repeat(40)} file.nupkg 9007199254740992`,
])("rejects incomplete or unsafe feed %s", (source) => {
  expect(() => parseSquirrelReleases(source)).toThrow();
});
