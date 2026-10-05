// Purpose: Compile Tea through a relocated desktop backend using only its shipped runtime.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const staging = resolve(
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "../dist"),
);
const root = await mkdtemp(join(tmpdir(), "openchart-tea-bundle-"));
let child: ReturnType<typeof fork> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  await cp(staging, join(root, "application"), {
    recursive: true,
    dereference: true,
  });
  await cp(join(dirname(staging), ".artifacts/docs"), join(root, "docs"), {
    recursive: true,
  });
  const bootstrap = join(root, "bootstrap.mjs");
  await writeFile(
    bootstrap,
    `
process.parentPort = {
  on(event, listener) { process.on(event, data => listener({data})); },
  postMessage(data) { process.send(data); },
};
await import('./application/main/backend.js');
process.send({type: 'bootstrapped'});
`,
  );
  const env = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  child = fork(bootstrap, [], {
    cwd: root,
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env,
  });
  let logs = "";
  child.stdout!.on("data", (data) => {
    logs += String(data);
  });
  child.stderr!.on("data", (data) => {
    logs += String(data);
  });
  const exited = once(child, "exit");
  const timeout = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(
      () => reject(new Error(`Relocated Tea backend timed out\n${logs}`)),
      30_000,
    );
  });
  const nextMessage = () =>
    Promise.race([
      once(child!, "message").then(([message]) => message),
      exited.then(([code]) => {
        throw new Error(`Relocated backend exited (${code})\n${logs}`);
      }),
      timeout,
    ]);
  assert.equal((await nextMessage()).type, "bootstrapped");
  const token = randomBytes(32).toString("hex");
  const ready = nextMessage();
  child.send({
    type: "init",
    token,
    credentialKey: randomBytes(32).toString("base64"),
    home: join(root, "home"),
    documentationDirectory: join(root, "docs"),
    rendererOrigin: "openchart://app",
    billingUrl: "http://127.0.0.1:1",
    openchartUrl: "http://127.0.0.1:1",
  });
  const message = await ready;
  assert.equal(message.type, "ready");
  assert.equal(typeof message.port, "number");
  const rpc = async (path: string, input?: unknown, query = false) => {
    const url = new URL(`http://127.0.0.1:${message.port}/trpc/${path}`);
    if (query && input !== undefined)
      url.searchParams.set("input", JSON.stringify(input));
    const response = await fetch(url, {
      method: query || input === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "openchart://app",
        "content-type": "application/json",
      },
      body: query || input === undefined ? undefined : JSON.stringify(input),
    });
    const payload: unknown = await response.json();
    assert(response.ok, JSON.stringify(payload));
    return z
      .object({ result: z.object({ data: z.unknown().optional() }) })
      .parse(payload).result.data;
  };
  const workspaceId = z
    .string()
    .parse(await rpc("resources.workspace.getDefault"));
  const workflowFiles = [
    "best-of-n.workflow.ts",
    "find-laggers.workflow.ts",
    "hypothesis-race.workflow.ts",
    "multi-angle-research.workflow.ts",
    "multi-turn-debate.workflow.ts",
    "thesis-killer.workflow.ts",
  ];
  assert.deepEqual(
    (
      await readdir(join(root, "home", "workspaces", "default", "workflows"))
    ).sort(),
    workflowFiles,
  );
  const workflowParts = z.array(z.object({ workflow: z.string() })).parse(
    await rpc("agent.buildCommand", {
      command: "best-of-n",
      arguments: "2 Research",
    }),
  );
  assert.equal(
    workflowParts[0]?.workflow,
    "default:workflows/best-of-n.workflow.ts",
  );
  const catalog = z
    .array(z.object({ id: z.string() }))
    .parse(await rpc("indicators.list"));
  const bundledIndicators = (
    await readdir(join(root, "application", "main", "builtins"))
  )
    .filter((name) => name.endsWith(".tea"))
    .sort();
  assert(catalog.length > 0);
  for (const { id } of catalog) assert(bundledIndicators.includes(`${id}.tea`));
  assert.deepEqual(
    (
      await readdir(
        join(root, "home", "workspaces", "default", "indicators", "builtin"),
      )
    ).sort(),
    bundledIndicators,
  );
  await rpc("workspace.write", {
    workspaceId,
    path: "compile-smoke.tea",
    expected: null,
    text: [
      "import geometry",
      "length = input.int(3)",
      'emit "average" ta.sma(close, length)',
      'emit "contact" geometry.segmentContact(0.0, 0.0, 2.0, 2.0, 0.0, 2.0, 2.0, 0.0)',
      'plot("close", close, "Price")',
    ].join("\n"),
  });
  // Compile returns the definition with its schemas in Arrow's JSON form.
  const fields = z.object({ fields: z.array(z.object({ name: z.string() })) });
  const node = z
    .object({
      id: z.string().min(1),
      definition: z.object({
        parameters: z.array(z.object({ name: z.string(), value: z.unknown() })),
        inputs: fields,
      }),
    })
    .parse(
      await rpc("tea.compile", {
        workspaceId,
        path: "compile-smoke.tea",
      }),
    );
  assert(node.id.length > 0);
  assert.equal(node.definition.parameters[0]!.name, "length");
  assert.equal(node.definition.parameters[0]!.value, 3);
  assert(node.definition.inputs.fields.some(({ name }) => name === "close"));
  await rpc("tea.dispose", { id: node.id });
  for (const id of ["sma", "macd", "bollinger-bands", "volume"]) {
    const source = z
      .object({ workspaceId: z.string(), path: z.string() })
      .parse(await rpc("indicators.install", { id }));
    const installed = z
      .object({
        id: z.string(),
        declaration: z.object({ title: z.string(), overlay: z.boolean() }),
        definition: z.object({ outputs: fields }),
      })
      .parse(await rpc("tea.compile", source));
    assert(installed.definition.outputs.fields.length > 0);
    assert.equal(source.workspaceId, workspaceId);
    await rpc("tea.dispose", { id: installed.id });
  }
  for (const [identifier, id] of [
    ["BTCUSDT", "crypto:btc"],
    ["Apple", "brand:apple.com"],
    ["stock:ABT", "brand:abbott.com"],
    ["crypto:ABT", "crypto:abt"],
  ]) {
    const logo = z
      .object({ id: z.string(), url: z.string() })
      .parse(await rpc("feed.logos.get", { identifier }, true));
    assert.equal(logo.id, id);
    assert.match(logo.url, /^data:image\/(?:jpeg|png|svg\+xml);base64,/);
  }
  const resource = z.object({ id: z.string().min(1) }).passthrough();
  const dashboard = resource.parse(
    await rpc("resources.dashboard.create", { name: "Boundary smoke" }),
  );
  const inputs = {
    provider: "binance",
    listing: { symbol: "BTCUSDT", currency: "USDT" },
    resolution: "1m",
    session: "24h",
    adjustment: "raw",
  };
  const drawing = resource.parse(
    await rpc("resources.drawing.create", {
      dashboardId: dashboard.id,
      provider: inputs.provider,
      listing: inputs.listing,
      data: {
        id: "boundary-smoke",
        type: "freehand",
        anchors: [
          { time: 60, price: 100 },
          { time: 120, price: 110 },
          { time: 90, price: 120 },
        ],
      },
    }),
  );
  for (const operator of ["crossing", "touching"]) {
    const alertable = {
      kind: "drawing",
      drawingId: drawing.id,
      operator,
      inputs,
    };
    const saved = z
      .object({ rule: resource, actions: z.array(resource) })
      .parse(
        await rpc("resources.macro.saveAlertRule", {
          value: {
            name: `Boundary ${operator}`,
            enabled: true,
            repeat: false,
            alertable,
          },
          actions: [],
        }),
      );
    assert.deepEqual(saved.rule.alertable, alertable);
    assert.deepEqual(
      await rpc("resources.alert_rule.get", { id: saved.rule.id }),
      saved.rule,
    );
    await rpc("resources.alert_rule.delete", { id: saved.rule.id });
  }
  child.send({ type: "shutdown" });
  assert.equal((await Promise.race([exited, timeout]))[0], 0);
  console.log(
    "Relocated desktop Tea compile/dispose, bundled logo reads and boundary alert saves passed.",
  );
} finally {
  clearTimeout(deadline);
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  }
  await rm(root, { recursive: true, force: true });
}
