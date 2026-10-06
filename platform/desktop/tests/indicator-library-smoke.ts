// Purpose: Exercise cached historical study previews and library actions in an isolated desktop profile.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, type Locator } from "@playwright/test";
import { z } from "zod";
import type { AgentInputs } from "@openchart/app/lib/transport/transport";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";
import { featuredStudies } from "@openchart/server/indicators/featured-studies";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const exampleDirectory = join(
  desktop,
  "../../app/src/features/chart/assets/market-examples",
);
const studyWindows = z
  .record(z.string(), z.object({ exampleId: z.string(), endTime: z.number() }))
  .parse(
    JSON.parse(
      await readFile(join(exampleDirectory, "study-windows.json"), "utf8"),
    ),
  );
const purposeHeroes = [
  ["Follow trends", "supertrend-regime"],
  ["Find breakouts", "bollinger-squeeze"],
  ["Find reversals", "rsi-divergence"],
  ["Read volume", "anchored-vwap-bands"],
  ["Understand volatility", "atr-percentile"],
  ["Read structure", "confirmed-swing-map"],
] as const;

// Read the actual mounted runtime; this creates no preview data or test-only renderer hooks.
function inspectChart(element: Element) {
  type Fiber = {
    child?: Fiber;
    sibling?: Fiber;
    alternate?: Fiber;
    memoizedProps?: Record<string, unknown>;
    memoizedState?: { memoizedState?: unknown; next?: unknown };
  };
  const section = element.matches("[data-chart-cell]")
    ? element
    : element.querySelector("[data-chart-cell]");
  const canvas = section?.querySelector("canvas");
  if (!section || !canvas)
    return {
      found: false,
      kinds: [] as string[],
      series: [] as { type: string; count: number }[],
      hits: [] as { kind: string; text: string; x: number; y: number }[],
    };
  const key = Object.keys(section).find((name) =>
    name.startsWith("__reactFiber$"),
  );
  const fiber = key
    ? (section as unknown as Record<string, Fiber>)[key]
    : undefined;
  const stack = fiber
    ? [fiber, fiber.alternate].filter((node): node is Fiber => !!node)
    : [];
  const seen = new Set<Fiber>();
  const kinds = new Set<string>();
  let chart: ChartRuntime | undefined;
  while (stack.length && seen.size < 5000) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const value = node.memoizedProps?.value as
      Partial<ChartRuntime> | undefined;
    if (
      value?.renderer?.canvas === canvas &&
      value.store &&
      typeof value.renderer.primitiveAt === "function"
    )
      chart = value as ChartRuntime;
    let hook = node.memoizedState;
    while (hook && typeof hook === "object") {
      const memo = hook.memoizedState;
      if (Array.isArray(memo)) {
        const projection = memo[0] as
          | { decorations?: { kind: string; rows: { value: unknown }[] }[] }
          | undefined;
        if (projection && Array.isArray(projection.decorations))
          for (const decoration of projection.decorations)
            if (decoration.rows.some((row) => row.value !== null))
              kinds.add(decoration.kind);
      }
      hook = hook.next as typeof hook;
    }
    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
  const series = chart
    ? Object.values(chart.store.getState().objects).flatMap((object) =>
        object.kind === "series"
          ? [{ type: object.series.type, count: object.series.data.length }]
          : [],
      )
    : [];
  const hits = new Map<
    string,
    { kind: string; text: string; x: number; y: number }
  >();
  if (chart) {
    const bounds = canvas.getBoundingClientRect();
    for (let y = 4; y < bounds.height; y += 8)
      for (let x = 4; x < bounds.width; x += 8) {
        const hit = chart.renderer.primitiveAt(x, y)?.data as
          { kind?: string; text?: string; time?: number } | undefined;
        if (hit?.kind && hit.text)
          hits.set(`${hit.kind}:${hit.text}:${hit.time}`, {
            kind: hit.kind,
            text: hit.text,
            x,
            y,
          });
      }
  }
  return {
    found: !!chart,
    kinds: [...kinds],
    series,
    hits: [...hits.values()],
  };
}
const manifest = z
  .array(
    z.object({
      id: z.string().regex(/^[a-z0-9]+-20\d{2}-1d$/),
      provider: z.string(),
      symbol: z.string(),
      year: z.number().int(),
    }),
  )
  .parse(
    JSON.parse(await readFile(join(exampleDirectory, "manifest.json"), "utf8")),
  );
const exampleIds = manifest.map(({ id }) => id);
assert.equal(manifest.length, 50);
assert.equal(new Set(exampleIds).size, 50);
const price = z.number().finite().nullable();
const bar = z.tuple([z.number(), price, price, price, price, price]);
const capturedExample = z.object({
  id: z.string(),
  instrument: z.object({
    provider: z.string(),
    listing: z.object({ symbol: z.string() }),
  }),
  displayRange: z.object({ from: z.number(), to: z.number() }),
  provenance: z.object({
    sourceUrl: z.string().url(),
    firstBarTime: z.number(),
    lastBarTime: z.number(),
    rowCount: z.number(),
    sha256: z.string(),
  }),
  bars: z.array(bar),
});
const hashBars = (bars: readonly z.infer<typeof bar>[]) =>
  createHash("sha256").update(JSON.stringify(bars)).digest("hex");
const examples = await Promise.all(
  manifest.map(async ({ id, provider, symbol, year }) => {
    const example = capturedExample.parse(
      JSON.parse(await readFile(join(exampleDirectory, `${id}.json`), "utf8")),
    );
    assert.equal(example.id, id);
    assert.equal(example.instrument.provider, provider);
    assert.equal(example.instrument.listing.symbol, symbol);
    assert.equal(example.displayRange.from, Date.UTC(year, 0, 1));
    assert.equal(example.displayRange.to, Date.UTC(year + 1, 0, 1));
    assert.equal(hashBars(example.bars), example.provenance.sha256);
    assert.equal(example.bars.length, example.provenance.rowCount);
    assert.equal(example.bars[0]![0], example.provenance.firstBarTime);
    assert.equal(example.bars.at(-1)![0], example.provenance.lastBarTime);
    const shown = example.bars.filter(
      ([time]) =>
        time >= example.displayRange.from && time < example.displayRange.to,
    );
    assert.ok(shown.length > 0);
    return example;
  }),
);
const profile = await mkdtemp(join(tmpdir(), "openchart-library-"));
const home = join(profile, "home");
const workspace = join(home, "workspaces/default");
const artifacts = join(desktop, ".artifacts");
await mkdir(workspace, { recursive: true });
await mkdir(artifacts, { recursive: true });
await writeFile(
  join(workspace, "library-smoke.tea"),
  'indicator("Personal study", overlay = false)\nlength = input.int(14, "Length", minval = 1)\nplot("value", ta.rsi(close, length), "Value")\n',
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
for (const key of [
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
  "NODE_PATH",
  "NODE_OPTIONS",
  "OPENCHART_DESKTOP_DEV_URL",
])
  delete env[key];
const application = await _electron.launch({
  args: [
    join(desktop, "dist"),
    `--user-data-dir=${join(profile, "browser")}`,
    `--openchart-home=${home}`,
    "--use-mock-keychain",
    "--openchart-test-account",
  ],
  env,
  timeout: 30_000,
});
const errors: string[] = [];
try {
  const page = await application.firstWindow({ timeout: 30_000 });
  page.on("pageerror", (error) => errors.push(error.message));
  // Count finite local Tea separately from provider Feed channels and packaged assets.
  const observation = z.object({
    type: z.literal("open"),
    body: z.object({
      type: z.literal("tea.open"),
      request: z.object({
        id: z.string(),
        parameters: z.record(z.string(), z.unknown()),
        inputs: z.record(z.string(), z.unknown()),
        requests: z.record(z.string(), z.unknown()),
        from: z.number(),
        to: z.union([z.number(), z.literal("now")]),
      }),
    }),
  });
  const executions: z.infer<typeof observation>["body"]["request"][] = [];
  const compilationResponse = z.object({
    result: z.object({
      data: z.object({
        id: z.string(),
        declaration: z.object({ title: z.string() }).nullable(),
      }),
    }),
  });
  const compiledTitles = new Map<string, string>();
  page.on("response", (response) => {
    if (!/\/trpc\/tea\.compile(?:$|\?)/.test(response.url())) return;
    void response.json().then(
      (body: unknown) => {
        const parsed = compilationResponse.safeParse(body);
        if (parsed.success && parsed.data.result.data.declaration)
          compiledTitles.set(
            parsed.data.result.data.id,
            parsed.data.result.data.declaration.title,
          );
      },
      () => {},
    );
  });
  const barsRequest = z.object({
    provider: z.string(),
    listing: z.record(z.string(), z.unknown()),
    resolution: z.string(),
    session: z.string(),
    adjustment: z.string(),
    from: z.number(),
    to: z.union([z.number(), z.literal("now")]),
    countBack: z.number(),
  });
  const barsOpen = z.object({
    type: z.literal("open"),
    id: z.string(),
    body: z.object({ type: z.literal("bars.open"), request: barsRequest }),
  });
  const providerRequests: {
    at: number;
    request: z.infer<typeof barsRequest>;
  }[] = [];
  const providerIdentity = ({
    provider,
    listing,
    resolution,
    session,
    adjustment,
    to,
  }: z.infer<typeof barsRequest>) =>
    JSON.stringify({
      provider,
      listing,
      resolution,
      session,
      adjustment,
      live: to === "now",
    });
  const channelReply = z.object({
    type: z.enum(["data", "error", "done", "close"]),
    id: z.string(),
  });
  const pendingMainBars = new Set<string>();
  const suppliedHistory = z.object({
    _tag: z.literal("Samples"),
    provider: z.string(),
    listing: z.object({ symbol: z.string() }),
    rows: z.array(
      z.object({
        time: z.number(),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: price,
      }),
    ),
  });
  let providerChannels = 0;
  let lastProviderActivity = 0;
  let lastTeaOpen = 0;
  let compileRequests = 0;
  const assetLoads: string[] = [];
  page.on("request", (request) => {
    if (/\/trpc\/tea\.compile(?:$|\?)/.test(request.url()))
      compileRequests += 1;
    const match =
      /\/([a-z0-9]+-20\d{2}-1d)(?:-[^/]*)?\.(?:js|json)(?:$|\?)/.exec(
        request.url(),
      );
    if (match) assetLoads.push(match[1]!);
  });
  const network = await page.context().newCDPSession(page);
  await network.send("Network.enable");
  network.on("Network.webSocketFrameSent", ({ response }) => {
    if (response.opcode !== 1) return;
    let payload: unknown;
    try {
      payload = JSON.parse(response.payloadData);
    } catch {
      return;
    }
    const closed = channelReply.safeParse(payload);
    if (closed.success && closed.data.type === "close")
      pendingMainBars.delete(closed.data.id);
    const openedBars = barsOpen.safeParse(payload);
    if (openedBars.success) {
      providerChannels += 1;
      lastProviderActivity = Date.now();
      providerRequests.push({
        at: lastProviderActivity,
        request: openedBars.data.body.request,
      });
      pendingMainBars.add(openedBars.data.id);
    }
    const parsed = observation.safeParse(payload);
    if (parsed.success) {
      executions.push(parsed.data.body.request);
      lastTeaOpen = Date.now();
    }
  });
  network.on("Network.webSocketFrameReceived", ({ response }) => {
    if (response.opcode !== 1) return;
    let payload: unknown;
    try {
      payload = JSON.parse(response.payloadData);
    } catch {
      return;
    }
    const reply = channelReply.safeParse(payload);
    if (reply.success && pendingMainBars.delete(reply.data.id))
      lastProviderActivity = Date.now();
  });
  const waitForHistoricalPreview = async (figure: Locator) => {
    await expect(figure.locator("canvas")).toBeVisible({ timeout: 30_000 });
    await expect(figure.locator("figcaption")).toHaveCount(0);
    await expect
      .poll(
        () =>
          figure.evaluate((element) => {
            const canvas = element.querySelector("canvas");
            if (!canvas)
              return { ready: false, statuses: ["Canvas not mounted"] };
            const context = canvas.getContext("2d");
            const pixels =
              context && canvas.width && canvas.height
                ? context.getImageData(0, 0, canvas.width, canvas.height).data
                : [];
            let coloredPixels = 0;
            // Neutral axes and an empty canvas cannot establish rendered prices.
            for (let index = 0; index < pixels.length; index += 64) {
              const colors = pixels.slice(index, index + 3);
              if (
                pixels[index + 3]! > 0 &&
                Math.max(...colors) - Math.min(...colors) > 24
              )
                coloredPixels += 1;
            }
            const statuses = Array.from(
              element.querySelectorAll('[role="status"]'),
              (status) => status.textContent?.trim(),
            );
            return {
              ready: statuses.length === 0 && coloredPixels > 12,
              statuses,
              coloredPixels,
            };
          }),
        {
          message:
            "Cached historical prices and computed Tea values must render",
          timeout: 45_000,
        },
      )
      .toMatchObject({ ready: true });
    await expect(figure).not.toContainText(
      /Historical\s*·|Illustrative sample/,
    );
  };
  const waitForSend = async (name: "Start a conversation" | "Send message") => {
    const button = page.getByRole("button", { name, exact: true });
    try {
      await expect(button).toBeEnabled({ timeout: 30_000 });
    } catch (error) {
      const readiness = await page
        .locator(
          '[aria-label="Select model"], [aria-label="Start a conversation"], [aria-label="Send message"]',
        )
        .evaluateAll((controls) =>
          controls.map((control) => ({
            name: control.getAttribute("aria-label"),
            disabled:
              control.matches(":disabled") ||
              control.getAttribute("aria-disabled") === "true",
            model:
              control.getAttribute("aria-label") === "Select model"
                ? control.textContent
                : undefined,
          })),
        );
      console.error("Agent model/send readiness:", JSON.stringify(readiness));
      throw error;
    }
    return button;
  };
  await page.waitForURL((url) => url.pathname.startsWith("/app"), {
    timeout: 30_000,
  });
  await page.setViewportSize({ width: 1280, height: 840 });
  // Finish the fresh profile's tour before exercising the normal chart surface.
  await page
    .getByRole("dialog", { name: "Connect your agent", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  for (const action of ["Next", "Next", "Next", "Next", "Next", "Done"])
    await page
      .locator(".onboarding-card")
      .getByRole("button", { name: action, exact: true })
      .click();
  await expect(page.locator(".onboarding-card")).toHaveCount(0);
  await page
    .locator('.widget-card:has(button[aria-label="Indicators"])')
    .first()
    .hover();
  const indicators = page
    .getByRole("button", { name: "Indicators", exact: true })
    .first();
  await indicators.focus();
  const mainReady = Date.now();
  await expect
    .poll(
      () =>
        pendingMainBars.size
          ? 0
          : Math.min(Date.now() - mainReady, Date.now() - lastProviderActivity),
      {
        message:
          "Main chart subscriptions should settle before counting library work",
        timeout: 30_000,
      },
    )
    .toBeGreaterThan(750);
  let providerBaseline = providerChannels;
  const mainMarkets = new Set(
    providerRequests.map(({ request }) => providerIdentity(request)),
  );
  let mainResizeChannels = 0;
  const previewExecutionStart = executions.length;
  const studyAssignments = new Map<string, string>();
  const inputHash = (input: z.infer<typeof suppliedHistory>) =>
    hashBars(
      input.rows.map(({ time, open, high, low, close, volume }) => [
        time,
        open,
        high,
        low,
        close,
        volume,
      ]),
    );
  const studyHash = async (title: string, since = previewExecutionStart) => {
    await expect
      .poll(
        () =>
          executions
            .slice(since)
            .filter((execution) => compiledTitles.get(execution.id) === title)
            .length,
        {
          message: `Observe the actual Tea program for ${title}`,
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0);
    const hashes = new Set(
      executions
        .slice(since)
        .filter((execution) => compiledTitles.get(execution.id) === title)
        .flatMap((execution) =>
          Object.values(execution.inputs).map((input) =>
            inputHash(suppliedHistory.parse(input)),
          ),
        ),
    );
    assert.equal(
      hashes.size,
      1,
      `${title} must keep the same capture across card, detail and filtering`,
    );
    const hash = [...hashes][0]!;
    const previous = studyAssignments.get(title);
    if (previous)
      assert.equal(
        hash,
        previous,
        `${title} must preserve its assigned capture`,
      );
    studyAssignments.set(title, hash);
    return hash;
  };
  const assertCachedPhase = (phase: string) => {
    assert.equal(
      providerChannels,
      providerBaseline,
      `${phase}: previews must not open Feed channels`,
    );
    const previews = executions.slice(previewExecutionStart);
    assert.ok(
      previews.length > 0,
      `${phase}: actual Tea executions must be observed`,
    );
    for (const execution of previews) {
      assert.deepEqual(
        execution.requests,
        {},
        `${phase}: preview cannot acquire request.security data`,
      );
      assert.ok(Object.keys(execution.inputs).length > 0);
      for (const value of Object.values(execution.inputs)) {
        const input = suppliedHistory.parse(value);
        const example = examples.find(
          (item) =>
            item.instrument.provider === input.provider &&
            item.instrument.listing.symbol === input.listing.symbol &&
            item.displayRange.from === execution.from,
        );
        assert.ok(
          example,
          `${phase}: preview must use a known historical capture`,
        );
        assert.equal(execution.from, example.displayRange.from);
        const title = compiledTitles.get(execution.id);
        const curated = featuredStudies.find((study) => study.name === title);
        const window = curated ? studyWindows[curated.id] : undefined;
        if (window) assert.equal(example.id, window.exampleId);
        assert.equal(
          execution.to,
          window?.endTime ?? example.displayRange.to,
          `${phase}: preview window must be finite`,
        );
        assert.equal(
          inputHash(input),
          example.provenance.sha256,
          `${phase}: supplied rows must match the captured provider data`,
        );
        if (title && studyAssignments.has(title))
          assert.equal(
            inputHash(input),
            studyAssignments.get(title),
            `${phase}: ${title} assignment changed`,
          );
      }
    }
    for (const id of exampleIds)
      assert.ok(
        assetLoads.filter((loaded) => loaded === id).length <= 1,
        `${phase}: ${id} should load once for all previews`,
      );
  };
  await indicators.click();
  const dialog = page.getByRole("dialog", { name: "Study library" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("OpenChart", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("heading", { name: "What are you looking for?" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Historical market example" }),
  ).toHaveCount(0);
  await expect(dialog.locator("figcaption")).toHaveCount(0);
  const firstStudyNames: string[] = [];
  const firstStudyHashes: string[] = [];
  const seenCurated = new Set<string>();
  const visualKinds = new Set<string>();
  for (const [purpose, heroId] of purposeHeroes) {
    await dialog.getByRole("tab", { name: purpose, exact: true }).click();
    const hero = featuredStudies.find(({ id }) => id === heroId)!;
    const card = dialog.getByRole("button", { name: hero.name, exact: true });
    await card.scrollIntoViewIfNeeded();
    await waitForHistoricalPreview(card.locator("figure"));
    await expect(
      card.getByRole("heading", { name: hero.headline, exact: true }),
    ).toBeVisible();
    firstStudyNames.push(hero.name);
    firstStudyHashes.push(await studyHash(hero.name));
    const rendered = await card.locator("figure").evaluate(inspectChart);
    assert.ok(
      rendered.found,
      `${hero.name}: mounted chart runtime should be available`,
    );
    rendered.kinds.forEach((kind) => visualKinds.add(kind));
    rendered.series.forEach(({ type, count }) => {
      if (count) visualKinds.add(type);
    });
    if (
      [
        "supertrend-regime",
        "rsi-divergence",
        "anchored-vwap-bands",
        "confirmed-swing-map",
      ].includes(heroId)
    )
      assert.ok(
        rendered.hits.length > 0,
        `${hero.name}: computed annotations must be painted and hittable: ${JSON.stringify(rendered)}`,
      );
    if (heroId === "rsi-divergence")
      assert.ok(
        rendered.hits.some(({ kind }) => kind === "segment"),
        "RSI divergence must paint its real confirmed price/momentum segments",
      );
    console.log(
      "Curated hero rendering:",
      JSON.stringify({ title: hero.name, ...rendered }),
    );
    await page.screenshot({
      path: join(artifacts, `indicator-library-purpose-${heroId}.png`),
    });
    const cards = dialog.locator("main button[aria-label]");
    const names = await cards.evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")!),
    );
    assert.ok(names.length >= 5, `${purpose}: curated content must be present`);
    for (const name of names) {
      assert.ok(
        featuredStudies.some((study) => study.name === name),
        `Discover must not include uncurated ${name}`,
      );
      const study = dialog.getByRole("button", { name, exact: true });
      await study.scrollIntoViewIfNeeded();
      await waitForHistoricalPreview(study.locator("figure"));
      await studyHash(name);
      seenCurated.add(name);
    }
    if (purpose === "Follow trends") {
      // The whole active tab stays mounted, including cards outside the viewport.
      await expect(cards.locator("canvas")).toHaveCount(names.length);
      await expect(cards.locator('[role="status"]')).toHaveCount(0);
      await expect.poll(() => Date.now() - lastTeaOpen).toBeGreaterThan(500);
      const chartIds = () =>
        cards
          .locator("[data-chart-cell]")
          .evaluateAll((charts) =>
            charts.map((chart) => chart.getAttribute("data-chart-cell")),
          );
      const mountedIds = await chartIds();
      assert.equal(new Set(mountedIds).size, names.length);
      const teaBeforeScroll = executions.length;
      const compileBeforeScroll = compileRequests;
      const scroll = dialog.locator("[data-library-scroll]");
      for (const bottom of [true, false, true, false]) {
        await scroll.evaluate(async (element, toBottom) => {
          element.scrollTop = toBottom ? element.scrollHeight : 0;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        }, bottom);
        await expect(cards.locator("canvas")).toHaveCount(names.length);
        await expect(cards.locator('[role="status"]')).toHaveCount(0);
        assert.deepEqual(
          await chartIds(),
          mountedIds,
          "Scrolling must retain each active-tab chart instance",
        );
        assert.equal(
          executions.length,
          teaBeforeScroll,
          "Scrolling must not reopen Tea executions",
        );
        assert.equal(
          compileRequests,
          compileBeforeScroll,
          "Scrolling must not compile previews again",
        );
      }
      console.log(
        `Active-tab scroll proof: ${names.length} mounted canvases retained their chart IDs across two down/up cycles; 0 new Tea executions and 0 compile requests.`,
      );
    }
    assertCachedPhase(purpose);
  }
  assert.equal(
    seenCurated.size,
    30,
    "All thirty curated studies must render across their purpose tabs",
  );
  assert.ok(
    visualKinds.has("fill"),
    "Curated previews must contain real filled regions",
  );
  assert.ok(
    visualKinds.has("segment"),
    "Curated previews must contain real segments",
  );
  assert.ok(
    visualKinds.has("Area"),
    "Curated previews must contain area plots",
  );
  assert.ok(
    new Set(firstStudyHashes).size >= 5,
    "The six purpose heroes must span distinct real captures",
  );
  await dialog.getByRole("tab", { name: "Follow trends", exact: true }).click();
  const gallery = dialog
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "More indicators to explore" }),
    })
    .getByRole("button");
  const firstRow = await gallery.evaluateAll((cards) =>
    cards.slice(0, 4).map((card) => {
      const { x, y, width } = card.getBoundingClientRect();
      return { x, y, width };
    }),
  );
  assert.equal(firstRow.length, 4);
  assert.ok(
    Math.abs(firstRow[0]!.y - firstRow[1]!.y) < 2 &&
      Math.abs(firstRow[1]!.y - firstRow[2]!.y) < 2 &&
      firstRow[1]!.x >= firstRow[0]!.x + firstRow[0]!.width &&
      firstRow[2]!.x >= firstRow[1]!.x + firstRow[1]!.width &&
      firstRow[3]!.y > firstRow[0]!.y,
    "Desktop discovery should show three preview cards per row",
  );
  await expect(dialog.locator("img")).toHaveCount(0);
  await expect(dialog.getByText(/Illustrative sample/)).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Supertrend Regime", exact: true })
    .scrollIntoViewIfNeeded();
  await waitForHistoricalPreview(
    dialog
      .getByRole("button", { name: "Supertrend Regime", exact: true })
      .locator("figure"),
  );
  assertCachedPhase("Browse thirty curated studies");
  const loadedExamples = [...assetLoads];
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await indicators.focus();
  const warmExecutionStart = executions.length;
  await indicators.click();
  await waitForHistoricalPreview(
    dialog
      .getByRole("button", { name: "Supertrend Regime", exact: true })
      .locator("figure"),
  );
  await studyHash("Supertrend Regime", warmExecutionStart);
  assertCachedPhase("Warm reopen");
  assert.deepEqual(
    assetLoads,
    loadedExamples,
    "Reopening must reuse all cached examples",
  );
  await page.screenshot({
    path: join(artifacts, "indicator-library-discover.png"),
  });
  const composer = dialog.getByRole("textbox", {
    name: "Search studies or create your own",
  });
  const searchAlignment = await composer.evaluate((input) => {
    const style = getComputedStyle(input);
    const icon = input.previousElementSibling!.getBoundingClientRect();
    return {
      textCenter:
        input.getBoundingClientRect().top +
        Number.parseFloat(style.borderTopWidth) +
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.lineHeight) / 2 -
        input.scrollTop,
      iconCenter: icon.top + icon.height / 2,
    };
  });
  assert.ok(
    Math.abs(searchAlignment.textCenter - searchAlignment.iconCenter) <= 1,
    `Search placeholder should align with its icon: ${JSON.stringify(searchAlignment)}`,
  );
  await composer.fill(firstStudyNames[1]!);
  await waitForHistoricalPreview(
    dialog
      .getByRole("button", { name: firstStudyNames[1]!, exact: true })
      .locator("figure"),
  );
  await studyHash(firstStudyNames[1]!);
  const macdCardStart = executions.length;
  await composer.fill("MACD");
  await expect(
    dialog.getByRole("button", { name: "MACD", exact: true }),
  ).toBeVisible();
  await waitForHistoricalPreview(
    dialog.getByRole("button", { name: "MACD", exact: true }).locator("figure"),
  );
  await studyHash("MACD", macdCardStart);
  const macdDetailStart = executions.length;
  await dialog.getByRole("button", { name: "MACD", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "MACD", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", {
      name: "Search studies or create your own",
    }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("heading", { name: "Source prompt" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Use this prompt" }),
  ).toHaveCount(0);
  await expect(dialog.locator("img")).toHaveCount(0);
  await expect(dialog.getByText(/Illustrative sample/)).toHaveCount(0);
  const addToChart = dialog.getByRole("button", {
    name: "Add to chart",
    exact: true,
  });
  await expect(addToChart).toBeEnabled();
  await expect(addToChart).toBeInViewport({ ratio: 1 });
  assert.equal(
    await dialog.locator("main").evaluate((main) => main.scrollTop),
    0,
  );
  const readingHeading = dialog.getByRole("heading", {
    name: "How to read it",
    exact: true,
  });
  const inputsHeading = dialog.getByRole("heading", {
    name: "Inputs",
    exact: true,
  });
  // Both sections must be discoverable before scrolling past the preview.
  // Intersection checks include clipping by the main body above the fixed footer.
  await expect(readingHeading).toBeInViewport({ ratio: 1 });
  await expect(inputsHeading).toBeInViewport({ ratio: 1 });
  const reading = readingHeading.locator("..");
  const inputs = inputsHeading.locator("..");
  const readingBounds = await reading.boundingBox();
  const inputBounds = await inputs.boundingBox();
  assert.ok(readingBounds && inputBounds);
  assert.ok(
    Math.abs(readingBounds.y - inputBounds.y) < 2 &&
      inputBounds.x >= readingBounds.x + readingBounds.width,
    "Desktop reading guide and inputs should share a row",
  );
  const detailPreview = dialog.locator("main figure");
  await waitForHistoricalPreview(detailPreview);
  await studyHash("MACD", macdDetailStart);
  const previewBounds = await detailPreview.boundingBox();
  const canvasBounds = await detailPreview.locator("canvas").boundingBox();
  assert.ok(previewBounds && canvasBounds);
  assert.ok(
    Math.abs(canvasBounds.width - previewBounds.width) <= 3,
    "Historical detail canvas should fill the available preview width",
  );
  const footerButtons = dialog.locator("footer").getByRole("button");
  await expect(footerButtons).toHaveText(["Open source", "Add to chart"]);
  await expect.poll(() => Date.now() - lastTeaOpen).toBeGreaterThan(500);
  const executionsBeforePan = executions.length;
  const detailAssetLoads = [...assetLoads];
  const canvas = detailPreview.locator("canvas");
  await canvas.hover();
  await page.mouse.move(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 3,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBounds.x + canvasBounds.width / 2 + 60,
    canvasBounds.y + canvasBounds.height / 3,
    { steps: 5 },
  );
  await page.mouse.up();
  const pannedAt = Date.now();
  await expect
    .poll(() => Math.min(Date.now() - pannedAt, Date.now() - lastTeaOpen))
    .toBeGreaterThan(500);
  await waitForHistoricalPreview(detailPreview);
  assert.equal(
    executions.length,
    executionsBeforePan,
    "Panning cached history must not reopen Tea executions",
  );
  assertCachedPhase("Pan historical detail");
  assert.deepEqual(
    assetLoads,
    detailAssetLoads,
    "Panning must not reload history",
  );
  await page.screenshot({
    path: join(artifacts, "indicator-library-detail.png"),
  });
  assertCachedPhase("Before responsive resize");
  const resizeProviderStart = providerRequests.length;
  const resizeStartedAt = Date.now();
  await page.setViewportSize({ width: 420, height: 740 });
  await expect(addToChart).toBeInViewport({ ratio: 1 });
  await expect
    .poll(
      () =>
        reading.evaluate((section) => {
          const guide = section.getBoundingClientRect();
          const parameters =
            section.nextElementSibling!.getBoundingClientRect();
          return {
            stacked:
              parameters.y >= guide.bottom &&
              Math.abs(parameters.x - guide.x) < 2,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            reading: {
              x: guide.x,
              y: guide.y,
              width: guide.width,
              height: guide.height,
            },
            inputs: {
              x: parameters.x,
              y: parameters.y,
              width: parameters.width,
              height: parameters.height,
            },
          };
        }),
      {
        message: "Narrow detail should stack the reading guide above inputs",
        timeout: 3_000,
      },
    )
    .toMatchObject({ stacked: true });
  await page.screenshot({
    path: join(artifacts, "indicator-library-detail-narrow.png"),
  });
  assert.ok(
    await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const main = element.querySelector("main")!;
      return (
        bounds.x >= 0 &&
        bounds.right <= window.innerWidth &&
        main.scrollWidth <= main.clientWidth
      );
    }),
    "Narrow detail must fit the window without horizontal scrolling",
  );
  await page.setViewportSize({ width: 1280, height: 840 });
  const resizeRestoredAt = Date.now();
  await expect
    .poll(
      () =>
        pendingMainBars.size
          ? 0
          : Math.min(
              Date.now() - resizeRestoredAt,
              Date.now() - lastProviderActivity,
            ),
      {
        message:
          "The underlying main chart should settle after responsive resizing",
        timeout: 30_000,
      },
    )
    .toBeGreaterThan(750);
  const resizedMainRequests = providerRequests.slice(resizeProviderStart);
  for (const { at, request } of resizedMainRequests) {
    assert.ok(at >= resizeStartedAt);
    assert.equal(
      request.to,
      "now",
      "Only the existing live main chart may acquire more bars during resize",
    );
    assert.ok(
      mainMarkets.has(providerIdentity(request)),
      `Unexpected Feed source during resize: ${JSON.stringify(request)}`,
    );
  }
  if (resizedMainRequests.length)
    console.log(
      "Main chart resize acquisitions:",
      JSON.stringify(resizedMainRequests.map(({ request }) => request)),
    );
  mainResizeChannels += resizedMainRequests.length;
  providerBaseline = providerChannels;
  assertCachedPhase("After responsive resize");
  await dialog
    .getByRole("button", { name: "Copy prompt", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "MACD", exact: true }),
  ).toBeVisible();
  await expect(composer).toHaveCount(0);
  await dialog
    .locator("header")
    .getByRole("button", { name: "Discover", exact: true })
    .click();
  await composer.fill("Price Volume Trend");
  await dialog
    .getByRole("button", { name: "Price Volume Trend", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Price Volume Trend", exact: true }),
  ).toBeVisible();
  await waitForHistoricalPreview(dialog.locator("main figure"));
  await expect(
    dialog.getByRole("heading", { name: "Inputs", exact: true }),
  ).toHaveCount(0);
  await expect(addToChart).toBeEnabled();
  await expect(addToChart).toBeInViewport({ ratio: 1 });
  await dialog
    .locator("header")
    .getByRole("button", { name: "Discover", exact: true })
    .click();
  await composer.fill("");
  await dialog.getByRole("button", { name: "My scripts", exact: true }).click();
  const personalExecutionStart = executions.length;
  await dialog.getByRole("button", { name: /library-smoke\.tea/ }).click();
  await expect(
    dialog.getByRole("heading", { name: "Personal study", exact: true }),
  ).toBeVisible();
  await waitForHistoricalPreview(dialog.locator("main figure"));
  const personalExecution = executions
    .slice(personalExecutionStart)
    .reverse()
    .find((execution) => execution.parameters.length === 14);
  assert.ok(
    personalExecution,
    "Personal preview must execute its declared inputs",
  );
  await studyHash("Personal study", personalExecutionStart);
  const personalAssetLoads = [...assetLoads];
  const length = dialog.getByRole("spinbutton", { name: "Length" });
  await expect(length).toHaveValue("14");
  await length.fill("17");
  await expect
    .poll(
      () =>
        executions.some(
          (execution) =>
            execution.id === personalExecution.id &&
            execution.parameters.length === 17,
        ),
      {
        message: "Editing Length must re-execute the same Tea program",
        timeout: 15_000,
      },
    )
    .toBe(true);
  await waitForHistoricalPreview(dialog.locator("main figure"));
  assertCachedPhase("Edit personal study inputs");
  assert.deepEqual(
    assetLoads,
    personalAssetLoads,
    "Editing inputs must reuse cached history",
  );
  console.log(
    `Historical preview proof: ${executions.length - previewExecutionStart} finite local Tea executions; ${assetLoads.length} packaged dataset loads; ${providerChannels - providerBaseline} preview Feed channels; ${mainResizeChannels} verified main-chart resize acquisitions.`,
  );
  await page.screenshot({
    path: join(artifacts, "indicator-library-personal.png"),
  });
  await dialog
    .getByRole("button", { name: "Add to chart", exact: true })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
  // Install the same annotated program on the actual chart; no test Feed or price injection.
  await page
    .locator('.widget-card:has(button[aria-label="Indicators"])')
    .first()
    .hover();
  await indicators.click();
  await composer.fill("Supertrend Regime");
  await dialog
    .getByRole("button", { name: "Supertrend Regime", exact: true })
    .click();
  await waitForHistoricalPreview(dialog.locator("main figure"));
  const installedExecutionStart = executions.length;
  await dialog
    .getByRole("button", { name: "Add to chart", exact: true })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  const mainChart = page.locator(".widget-card [data-chart-cell]").first();
  await expect
    .poll(
      async () => {
        const rendered = await mainChart.evaluate(inspectChart);
        return {
          fill: rendered.kinds.includes("fill"),
          signal: rendered.hits.some(
            ({ text }) => text === "Trend up" || text === "Trend down",
          ),
        };
      },
      {
        message:
          "Installed Supertrend must render the same real fill and annotations on the normal chart",
        timeout: 30_000,
      },
    )
    .toEqual({ fill: true, signal: true });
  assert.ok(
    executions
      .slice(installedExecutionStart)
      .some(
        (execution) =>
          compiledTitles.get(execution.id) === "Supertrend Regime" &&
          Object.values(execution.inputs).some(
            (input) =>
              z.object({ _tag: z.literal("Bars") }).safeParse(input).success,
          ),
      ),
    "Installed study must execute on the normal chart's actual market binding",
  );
  await page.screenshot({
    path: join(artifacts, "indicator-library-installed-study.png"),
  });
  await page
    .locator('.widget-card:has(button[aria-label="Indicators"])')
    .first()
    .hover();
  await page
    .getByRole("button", { name: "Indicators", exact: true })
    .first()
    .click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Indicators", exact: true }).first(),
  ).toBeFocused();

  // Keep creation/navigation real; reject admission before any provider executes.
  const submissions: AgentInputs["prompt"][] = [];
  await page.route("**/trpc/agent.prompt", async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "Smoke test admission unavailable",
          code: -32603,
          data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 },
        },
      }),
    });
  });
  await page
    .getByRole("button", { name: "Indicators", exact: true })
    .first()
    .click();
  await composer.fill("");
  await dialog.getByRole("button", { name: "My scripts", exact: true }).click();
  await dialog.getByRole("button", { name: /library-smoke\.tea/ }).click();
  await dialog.getByRole("button", { name: "Modify with Agent" }).click();
  const draft = await composer.inputValue();
  await waitForSend("Start a conversation");
  await composer.press("Enter");
  await page.waitForURL((url) => url.pathname.startsWith("/app/sessions/"));
  const sessionUrl = page.url();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
  const sessionComposer = page.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  await expect(sessionComposer).toHaveText(draft.trim());
  assert.equal(submissions.length, 1);
  assert.ok(
    JSON.stringify(submissions[0]).includes("Study library target: chart"),
  );
  assert.ok(
    JSON.stringify(submissions[0]).includes("exact path library-smoke.tea"),
  );
  await (await waitForSend("Send message")).click();
  await expect.poll(() => submissions.length).toBe(2);
  await expect(sessionComposer).toHaveText(draft.trim());
  assert.equal(
    page.url(),
    sessionUrl,
    "Retry must stay on the created Session",
  );
  assert.equal(submissions[1]!.sessionID, submissions[0]!.sessionID);
  assert.deepEqual(
    submissions[1]!.input,
    submissions[0]!.input,
    "Retry must retain the captured source context",
  );
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join("; ")}`);
  console.log(
    "Study library desktop smoke passed: thirty curated studies, six purpose heroes, fills/areas/segments and hittable annotations, real installed-study rendering, finite cached previews, no preview Feed channels, desktop/narrow layouts, search, copy, zero-input study, parameter recomputation, close/reopen, Session navigation and failed-submission retry.",
  );
} catch (error) {
  const failedPage = application.windows()[0];
  if (failedPage) {
    await failedPage.screenshot({
      path: join(artifacts, "indicator-library-failure.png"),
    });
    console.error(
      "Library failure state:",
      await failedPage
        .locator('[role="dialog"] [role="status"], [data-sonner-toast]')
        .allTextContents(),
    );
  }
  throw error;
} finally {
  await application.close();
  await rm(profile, { recursive: true, force: true });
}
