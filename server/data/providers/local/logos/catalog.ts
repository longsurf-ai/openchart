// Purpose: Own canonical logo identities and conservative alias/name matching.
import { Schema } from "effect";

/** Only catalog-owned image paths can reach the bundled asset reader. */
export const LogoCatalog = Schema.Array(
  Schema.Struct({
    id: Schema.String.check(Schema.isPattern(/^(?:brand|crypto):\S+$/)),
    name: Schema.NonEmptyString,
    asset: Schema.String.check(
      Schema.isPattern(
        /^(?:brands\/[a-z0-9_.-]+\.jpg|company\/[A-Z0-9.]+\.png|crypto\/[a-z0-9$-]+\.(?:svg|png|jpg))$/,
      ),
    ),
    identifiers: Schema.Array(Schema.NonEmptyString).check(
      Schema.isMinLength(1),
    ),
    listings: Schema.Array(
      Schema.Struct({
        symbol: Schema.NonEmptyString,
        exchange: Schema.NonEmptyString,
        source: Schema.String.check(Schema.isPattern(/^https:\/\//)),
      }),
    ).check(Schema.isMinLength(1)),
  }),
).check(
  Schema.makeFilter(
    (rows) =>
      new Set(rows.map((row) => row.id.toLowerCase())).size === rows.length,
    {
      message: "Logo identities must be unique",
    },
  ),
);
type LogoEntry = (typeof LogoCatalog.Type)[number];

const normalize = (text: string) =>
  text.trim().toLowerCase().replace(/\s+/g, " ");

function oneEditApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  while (i < left.length && left[i] === right[i]) i++;
  if (left.length !== right.length)
    return left.length > right.length
      ? left.slice(i + 1) === right.slice(i)
      : left.slice(i) === right.slice(i + 1);
  return (
    left.slice(i + 1) === right.slice(i + 1) ||
    (left[i] === right[i + 1] &&
      left[i + 1] === right[i] &&
      left.slice(i + 2) === right.slice(i + 2))
  );
}

/** Index exact aliases once. Fuzzy matching accepts name prefixes or one typo,
 * only from five characters onward. All ties survive for the Feed to reject.
 * @example const matches = logoSearch(catalog)("BTCUSDT");
 */
export function logoSearch(catalog: typeof LogoCatalog.Type) {
  const identities = new Map(
    catalog.map((entry) => [normalize(entry.id), entry]),
  );
  const exact = new Map<string, LogoEntry[]>();
  const names = catalog.map((entry) => ({
    entry,
    name: normalize(entry.name),
  }));
  for (const entry of catalog) {
    const identifiers = [...entry.identifiers, entry.id];
    for (const key of new Set(identifiers.map(normalize))) {
      const entries = exact.get(key);
      if (entries) entries.push(entry);
      else exact.set(key, [entry]);
    }
  }
  return (identifier: string): readonly LogoEntry[] => {
    const query = normalize(identifier);
    // A canonical ID cannot be shadowed by another asset's name or pair alias.
    const identity = identities.get(query);
    if (identity) return [identity];
    const matches = exact.get(query);
    if (matches) return matches;
    if (query.length < 5) return [];
    // ponytail: linear name scan for the bundled catalog; index if catalog growth makes it slow.
    return names
      .filter(
        ({ name }) =>
          name.length >= 5 &&
          (name.startsWith(query) || oneEditApart(query, name)),
      )
      .map(({ entry }) => entry);
  };
}
