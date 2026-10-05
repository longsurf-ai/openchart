// Purpose: Load versioned real historical examples once, without contacting a market provider.
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { ProviderId } from "@openchart/market";
import type { BarsSeries } from "@openchart/feed";
import type * as Tea from "@openchart/tea";
import manifest from "@openchart/app/features/chart/assets/market-examples/manifest.json";
import studyWindows from "@openchart/app/features/chart/assets/market-examples/study-windows.json";

/** Packaged sample inventory, parsed once; each ID resolves to one captured source and year. */
export const indicatorExampleManifest = z
  .array(
    z.object({
      id: z.string().min(1),
      provider: z.enum(["yfinance", "binance"]),
      symbol: z.string().min(1),
      year: z.number().int(),
    }),
  )
  .min(1)
  .refine(
    (entries) => new Set(entries.map(({ id }) => id)).size === entries.length,
    "Historical example IDs must be unique",
  )
  .parse(manifest);
export type IndicatorExampleId =
  (typeof indicatorExampleManifest)[number]["id"];

/** Editorial windows chosen by running the actual studies on packaged bars. */
export const indicatorStudyWindows = z
  .record(
    z.string(),
    z.object({
      exampleId: z
        .string()
        .refine((id) =>
          indicatorExampleManifest.some((entry) => entry.id === id),
        ),
      endTime: z.number().int().positive(),
    }),
  )
  .parse(studyWindows);

function hash(value: string) {
  let result = 2166136261;
  for (const character of value)
    result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

const shuffledExampleIds = indicatorExampleManifest
  .map(({ id }) => id)
  .sort(
    (a, b) =>
      hash(`study-library:${a}`) - hash(`study-library:${b}`) ||
      a.localeCompare(b),
  );

/** Distribute the complete catalog across a stable shuffled pool; filtering never reassigns a study.
 * @example const assignments = assignIndicatorExamples(catalog.map(({id}) => id));
 */
export function assignIndicatorExamples(
  studyIds: readonly string[],
): ReadonlyMap<string, IndicatorExampleId> {
  const ids = [...new Set(studyIds)].sort();
  const assignments = new Map<string, string>();
  const counts = new Map(shuffledExampleIds.map((id) => [id, 0]));
  for (const id of ids) {
    const chosen = indicatorStudyWindows[id]?.exampleId;
    if (chosen) {
      assignments.set(id, chosen);
      counts.set(chosen, counts.get(chosen)! + 1);
    }
  }
  for (const id of ids) {
    if (assignments.has(id)) continue;
    const fewest = Math.min(...counts.values());
    const chosen = shuffledExampleIds.find(
      (exampleId) => counts.get(exampleId) === fewest,
    )!;
    assignments.set(id, chosen);
    counts.set(chosen, fewest + 1);
  }
  return new Map(ids.map((id) => [id, assignments.get(id)!]));
}

/** Give a personal script a stable example using its complete Workspace identity.
 * @example const id = indicatorExampleForKey(JSON.stringify([workspaceId,path]));
 */
export function indicatorExampleForKey(key: string): IndicatorExampleId {
  return shuffledExampleIds[hash(key) % shuffledExampleIds.length]!;
}

const timestamp = z.number().int().nonnegative();
const range = z
  .object({ from: timestamp, to: timestamp })
  .refine(({ from, to }) => from < to);
const price = z.number().finite().nullable();
const exampleAsset = z
  .object({
    id: z.string().min(1),
    instrument: z.object({
      provider: z.enum(["yfinance", "binance"]),
      listing: z.object({
        symbol: z.string().min(1),
        currency: z.string().min(1),
        name: z.string().optional(),
        class: z.enum(["stock", "etf", "crypto"]),
        venue: z.string().min(1),
      }),
    }),
    // The daily bars an example draws, or the same market's weeks and months.
    resolution: z.enum(["1d", "1W", "1M"]),
    session: z.enum(["regular", "24h"]),
    adjustment: z.enum(["split", "raw"]),
    displayRange: range,
    provenance: z.object({
      sourceUrl: z.string().url(),
      sourceUrls: z.array(z.string().url()).min(1),
      retrievedAt: z.string().datetime(),
      requestedRange: range,
      firstBarTime: timestamp,
      lastBarTime: timestamp,
      rowCount: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    bars: z
      .array(
        z.tuple([
          timestamp,
          price,
          price,
          price,
          price,
          z.number().finite().nonnegative().nullable(),
        ]),
      )
      .min(1),
  })
  .superRefine((asset, ctx) => {
    const { bars, displayRange, provenance } = asset;
    if (bars.some(([time], index) => index > 0 && time <= bars[index - 1]![0]))
      ctx.addIssue({
        code: "custom",
        message: "Historical bars must strictly ascend",
        path: ["bars"],
      });
    if (
      bars.length !== provenance.rowCount ||
      bars[0]![0] !== provenance.firstBarTime ||
      bars.at(-1)![0] !== provenance.lastBarTime
    )
      ctx.addIssue({
        code: "custom",
        message: "Historical data does not match its provenance",
        path: ["provenance"],
      });
    if (
      bars.some(
        ([time]) =>
          time < provenance.requestedRange.from ||
          time >= provenance.requestedRange.to,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Historical bars exceed their acquired range",
        path: ["bars"],
      });
    if (
      displayRange.from < provenance.requestedRange.from ||
      displayRange.to > provenance.requestedRange.to ||
      !bars.some(
        ([time]) => time >= displayRange.from && time < displayRange.to,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "The example needs acquired history in its display range",
        path: ["displayRange"],
      });
  });

/** Parse one bundled provider capture at the asset boundary; callers share its immutable rows.
 * Throws if the content or provenance is inconsistent. @example const capture = parseIndicatorExample(asset);
 */
export function parseIndicatorExample(asset: unknown) {
  const data = exampleAsset.parse(asset);
  const series: BarsSeries = {
    provider: ProviderId.make(data.instrument.provider),
    listing: data.instrument.listing,
    resolution: data.resolution,
    session: data.session,
    adjustment: data.adjustment,
  };
  const rows: Tea.Samples["rows"] = Object.freeze(
    data.bars.map(([time, open, high, low, close, volume]) =>
      Object.freeze({ time, open, high, low, close, volume }),
    ),
  );
  return Object.freeze({
    id: data.id,
    series,
    rows,
    from: data.displayRange.from,
    to: data.displayRange.to,
    provenance: data.provenance,
  });
}
type Capture = ReturnType<typeof parseIndicatorExample>;
/** A packaged example: its daily bars, and the same market's weekly and
 * monthly bars over the same years, which a study's request.security lines
 * read, since a preview never reads market data. */
export type IndicatorExample = Capture & {
  readonly history: readonly Capture[];
};

const assets = import.meta.glob<{ default: unknown }>(
  "/src/features/chart/assets/market-examples/*-1d.json",
);
const periodAssets = import.meta.glob<{ default: unknown }>([
  "/src/features/chart/assets/market-examples/*-1W.json",
  "/src/features/chart/assets/market-examples/*-1M.json",
]);
const periods = ["1W", "1M"] as const;

/** Load each packaged history once per app session; no provider requests or background refresh.
 * @example useQuery(indicatorExampleQueryOptions("nvda-2024-1d"));
 */
export function indicatorExampleQueryOptions(id: IndicatorExampleId) {
  return queryOptions({
    queryKey: ["indicator-example", id],
    queryFn: async () => {
      const load =
        assets[`/src/features/chart/assets/market-examples/${id}.json`];
      const entry = indicatorExampleManifest.find((entry) => entry.id === id);
      if (!load || !entry)
        throw new Error("Historical example is not included in this library");
      const example = parseIndicatorExample((await load()).default);
      if (
        example.id !== id ||
        example.series.provider !== entry.provider ||
        example.series.listing.symbol !== entry.symbol ||
        new Date(example.from).getUTCFullYear() !== entry.year
      )
        throw new Error("Historical example identity does not match its asset");
      const history = await Promise.all(
        periods.map(async (resolution) => {
          const load =
            periodAssets[
              `/src/features/chart/assets/market-examples/${id.replace(/-1d$/, `-${resolution}`)}.json`
            ];
          if (!load) throw new Error("Historical example is incomplete");
          const capture = parseIndicatorExample((await load()).default);
          if (
            capture.series.resolution !== resolution ||
            capture.series.provider !== example.series.provider ||
            capture.series.listing.symbol !== example.series.listing.symbol ||
            capture.series.session !== example.series.session ||
            capture.series.adjustment !== example.series.adjustment ||
            capture.from !== example.from ||
            capture.to !== example.to
          )
            throw new Error(
              "Historical example identity does not match its asset",
            );
          return capture;
        }),
      );
      return Object.freeze({ ...example, history: Object.freeze(history) });
    },
    staleTime: Infinity,
    gcTime: Infinity,
    meta: { errorTitle: "Couldn’t load historical example" },
  });
}
