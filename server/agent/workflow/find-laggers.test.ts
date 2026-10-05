// Purpose: Verifies event gates, bounded research, observed returns and conservative laggard qualification.

import { buildCommand } from "@openchart/server/agent/command/command";
import { Deferred, Effect } from "effect";
import { expect, test } from "vitest";
import { defaultWorkflowFixture } from "./defaults.test-utils";
import { run } from "./runtime";
import { Workflow } from "./workflow";

const loadDefaultWorkflow = defaultWorkflowFixture();

const request = "SEED rallied on new demand; find US downstream laggards";
const eventTime = 1_780_000_000_000;
const day = 86_400_000;
const evidence = [
  {
    finding: "Confirmed demand expansion",
    sourceUrl: "https://example.com/filing",
    publishedAt: "2026-05-28",
  },
];
const event = {
  status: "ready",
  event: "Demand expansion",
  eventTime,
  market: "US listings",
  horizon: "Next quarter",
  reasoning: "Customer orders can expand",
  evidence,
};
const candidate = (symbol: string) => ({
  company: `${symbol} company`,
  symbol,
  exchange: "XNAS",
  relationship: "Disclosed downstream exposure",
  evidence,
});
const discovery = {
  pathways: [
    {
      mechanism: "Demand expands downstream orders",
      candidates: [candidate("AAA"), candidate("BBB")],
    },
  ],
};
const business = {
  benefit: "supported",
  materiality: "material",
  reasoning: "Meaningful disclosed exposure",
  evidence,
  missingEvidence: [],
};
const prices = (symbol: string, before = 100, latest = 101) => ({
  provider: "fixture",
  listing: { symbol, currency: "USD", mic: "XNAS" },
  resolution: "1d",
  session: "regular",
  adjustment: "split",
  lookback: { time: eventTime - 30 * day, close: before * 0.9 },
  beforeEvent: { time: eventTime - day, close: before },
  latest: { time: eventTime + day, close: latest },
});
const market = (symbol: string) => ({
  status: "usable",
  explanation: "Aligned completed observations",
  prices: prices(symbol),
  marketBenchmark: prices("MARKET", 200, 204),
  sectorBenchmark: prices("SECTOR", 50, 52),
  volatilityContext: "Volatility is unknown",
});
const assessment = {
  decision: "retain",
  reasoning: "Material exposure with a muted observed response",
  strongestCounterargument: "Demand may already be anticipated",
  evidence,
  nextCatalyst: "Next order disclosure",
  invalidationCondition: "Orders fail to expand",
};
const followUp = {
  findings: evidence,
  conclusion: "Demand remains supported",
  unresolvedQuestions: [],
};
const followUpQuestion = "Do customer orders confirm incremental demand?";

interface Fixture {
  event?: typeof event;
  discovery?: typeof discovery;
  business?: typeof business;
  market?: (symbol: string) => ReturnType<typeof market>;
  failedChecks?: string[];
  followUp?: boolean;
  failFollowUp?: boolean;
  proveParallel?: boolean;
  decision?: string;
  omitAssessment?: boolean;
}

async function execute(fixture: Fixture = {}) {
  const prompts: string[] = [];
  const model = {
    providerID: "codex" as const,
    modelID: "tier4" as const,
    selectedVariant: "high",
  };
  let checkCount = 0;
  let reviewSession = "";
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const parts = yield* buildCommand({
        command: "find-laggers",
        arguments: request,
      });
      const part = parts[0]!;
      if (part.type !== "workflow")
        return yield* Effect.die("Missing workflow");
      const definition = yield* loadDefaultWorkflow(part.workflow);
      const allChecksStarted = yield* Deferred.make<void>();
      return yield* run(definition, part.args).pipe(
        Effect.provideService(Workflow.Service, {
          parentPrompt: { agent: "analyst", model, parts },
          settings: { concurrency: 5 },
          agent: (input, onSession, options) =>
            Effect.gen(function* () {
              const text = input.parts.find(
                (part) => part.type === "text",
              )!.text;
              prompts.push(text);
              expect(input.model).toEqual(model);
              expect(input.agent).toBe("analyst");
              expect(options?.outputSchema).toMatchObject({ type: "object" });
              expect(text).toContain(request);
              const sessionId =
                options?.sessionId ?? `session-${prompts.length}`;
              yield* onSession(sessionId);
              let output: unknown;
              if (text.startsWith("Identify the new information"))
                output = fixture.event ?? event;
              else if (text.startsWith("Find up to three"))
                output = fixture.discovery ?? discovery;
              else if (
                text.startsWith("Independently verify") ||
                text.startsWith("Collect price")
              ) {
                checkCount++;
                if (fixture.proveParallel) {
                  if (checkCount === 4)
                    yield* Deferred.succeed(allChecksStarted, undefined);
                  yield* Deferred.await(allChecksStarted);
                }
                const symbol = /"symbol":"([^"]+)"/.exec(text)![1]!;
                const kind = text.startsWith("Collect price")
                  ? "market"
                  : "business";
                if (fixture.failedChecks?.includes(`${kind}:${symbol}`))
                  return yield* Effect.fail(
                    new Error(`${kind}:${symbol} unavailable`),
                  );
                if (kind === "market") {
                  expect(text).not.toContain("Disclosed downstream exposure");
                  output = (fixture.market ?? market)(symbol);
                } else output = fixture.business ?? business;
              } else if (
                text.startsWith("Review every candidate") ||
                text.startsWith("Finalize each")
              ) {
                const isFinal = text.startsWith("Finalize each");
                if (isFinal) {
                  expect(options?.sessionId).toBe(reviewSession);
                  expect(text).toContain(followUpQuestion);
                  expect(text).toContain(
                    fixture.failFollowUp
                      ? "follow-up unavailable"
                      : JSON.stringify(followUp),
                  );
                } else {
                  expect(options?.sessionId).toBeUndefined();
                  reviewSession = sessionId;
                  for (const failure of fixture.failedChecks ?? [])
                    expect(text).toContain(`${failure} unavailable`);
                }
                const schema = options!.outputSchema as {
                  properties: {
                    assessments: { properties: Record<string, unknown> };
                  };
                };
                const ids = Object.keys(
                  schema.properties.assessments.properties,
                );
                output = {
                  assessments: Object.fromEntries(
                    ids
                      .filter(
                        (_, index) => !fixture.omitAssessment || index > 0,
                      )
                      .map((id) => [
                        id,
                        {
                          ...assessment,
                          decision: fixture.decision ?? "retain",
                        },
                      ]),
                  ),
                  ...(isFinal
                    ? {}
                    : {
                        followUpQuestion: fixture.followUp
                          ? followUpQuestion
                          : null,
                      }),
                };
              } else if (text.startsWith("Investigate the reviewer")) {
                expect(text).toContain(followUpQuestion);
                if (fixture.failFollowUp)
                  return yield* Effect.fail(new Error("follow-up unavailable"));
                output = followUp;
              } else return yield* Effect.die(`Unexpected prompt: ${text}`);
              return { sessionId, output: JSON.stringify(output) };
            }),
        }),
      );
    }).pipe(Effect.timeout("10 seconds"), Effect.result),
  );
  return { result, prompts, checkCount };
}

test.each([false, true])(
  "runs independent checks and one optional follow-up (%s), computing benchmark-relative returns",
  async (withFollowUp) => {
    const { result, prompts, checkCount } = await execute({
      followUp: withFollowUp,
      proveParallel: true,
    });
    expect(checkCount).toBe(4);
    expect(prompts).toHaveLength(withFollowUp ? 9 : 7);
    const cutoffs = prompts.map(
      (prompt) => /Fixed analysis cutoff .*?: (\d+)/.exec(prompt)![1],
    );
    expect(new Set(cutoffs).size).toBe(1);
    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        findings: [
          {
            decision: "retain",
            returns: {
              beforeEventPct: expect.closeTo(11.1111, 3),
              sinceEventPct: expect.closeTo(1),
              marketExcessPct: expect.closeTo(-1),
              sectorExcessPct: expect.closeTo(-3),
            },
          },
          { decision: "retain" },
        ],
      },
    });
  },
);

test.each(["unresolved", "no_spillover"])(
  "stops after a %s event",
  async (status) => {
    const { result, prompts } = await execute({ event: { ...event, status } });
    expect(prompts).toHaveLength(1);
    expect(result).toMatchObject({
      _tag: "Success",
      success: { findings: [], stopReason: expect.any(String) },
    });
  },
);

test("does not fan out on an unsourced event or an empty discovery", async () => {
  const unsourced = await execute({ event: { ...event, evidence: [] } });
  expect(unsourced.prompts).toHaveLength(1);
  const empty = await execute({ discovery: { pathways: [] } });
  expect(empty.prompts).toHaveLength(2);
  expect(empty.result).toMatchObject({
    _tag: "Success",
    success: { findings: [] },
  });
});

test("deduplicates listings across pathways, preserves paths and caps total research at eight", async () => {
  const candidates = Array.from({ length: 8 }, (_, index) =>
    candidate(`C${index}`),
  );
  const { result, checkCount } = await execute({
    discovery: {
      pathways: [
        { mechanism: "First path", candidates },
        {
          mechanism: "Second path",
          candidates: [candidate(" c0 "), candidate("EXTRA")],
        },
      ],
    },
  });
  expect(checkCount).toBe(16);
  expect(result).toMatchObject({
    _tag: "Success",
    success: {
      findings: expect.arrayContaining([
        {
          ...assessment,
          id: "1",
          candidate: {
            ...candidate("C0"),
            pathways: ["First path", "Second path"],
          },
          returns: expect.any(Object),
          qualificationLimit: null,
        },
      ]),
    },
  });
  if (result._tag === "Success")
    expect(result.success).toHaveProperty("findings.length", 8);
});

test.each(["business:AAA", "market:AAA"])(
  "keeps a failed %s check unresolved despite a positive reviewer",
  async (failure) => {
    const { result } = await execute({ failedChecks: [failure] });
    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        findings: [
          { decision: "unresolved", qualificationLimit: expect.any(String) },
          { decision: "retain" },
        ],
      },
    });
  },
);

test.each(["stale", "misaligned", "before-event", "future", "reversed"])(
  "does not qualify %s price evidence",
  async (kind) => {
    const { result } = await execute({
      market: (symbol) => {
        const data = market(symbol);
        if (kind === "stale") data.status = "unavailable";
        if (kind === "misaligned") data.marketBenchmark.latest.time -= 1;
        if (kind === "before-event") data.prices.latest.time = eventTime - 1;
        if (kind === "future") data.prices.latest.time = 9_000_000_000_000;
        if (kind === "reversed")
          data.prices.lookback.time = data.prices.beforeEvent.time;
        return data;
      },
    });
    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        findings: [{ decision: "unresolved" }, { decision: "unresolved" }],
      },
    });
  },
);

test("rejects sourced immaterial business exposure despite a positive reviewer", async () => {
  const { result } = await execute({
    business: { ...business, materiality: "immaterial" },
  });
  expect(result).toMatchObject({
    _tag: "Success",
    success: {
      findings: [{ decision: "reject" }, { decision: "reject" }],
    },
  });
});

test("retains no candidates when all are rejected", async () => {
  const { result } = await execute({ decision: "reject" });
  expect(result).toMatchObject({
    _tag: "Success",
    success: { findings: [{ decision: "reject" }, { decision: "reject" }] },
  });
});

test("reports a failed follow-up and still finishes the reviewer session", async () => {
  const { result, prompts } = await execute({
    followUp: true,
    failFollowUp: true,
  });
  expect(prompts).toHaveLength(9);
  expect(result).toMatchObject({
    _tag: "Success",
    success: { followUp: { status: "error" }, finalReview: expect.any(Object) },
  });
});

test("missing checks remain unresolved even if the reviewer rejects them, without pointless follow-up", async () => {
  const { result, prompts } = await execute({
    failedChecks: ["market:AAA", "market:BBB"],
    decision: "reject",
    followUp: true,
  });
  expect(prompts).toHaveLength(7);
  expect(result).toMatchObject({
    _tag: "Success",
    success: {
      followUp: null,
      finalReview: null,
      findings: [{ decision: "unresolved" }, { decision: "unresolved" }],
    },
  });
});

test("rejects an omitted candidate assessment", async () => {
  const { result } = await execute({ omitAssessment: true });
  expect(result).toMatchObject({
    _tag: "Failure",
    failure: { _tag: "Workflow.InvalidOutput" },
  });
});

test("rejects more than three discovery paths before candidate research", async () => {
  const { result, checkCount } = await execute({
    discovery: {
      pathways: Array.from({ length: 4 }, () => discovery.pathways[0]!),
    },
  });
  expect(checkCount).toBe(0);
  expect(result).toMatchObject({
    _tag: "Failure",
    failure: { _tag: "Workflow.InvalidOutput" },
  });
});
