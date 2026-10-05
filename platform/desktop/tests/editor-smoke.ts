// Purpose: Test Tea editing and TypeScript highlighting in isolated Electron.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect } from "@playwright/test";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = await mkdtemp(join(tmpdir(), "openchart-editor-"));
const home = join(profile, "home");
const workspace = join(home, "workspaces/default");
await mkdir(workspace, { recursive: true });
const filename = join(workspace, "main.tea");
const broken =
  'fast = ta.ema(close, 9)\nplot("fast", fasst)\nemit "average" fast\n';
const fixed = broken.replace("fasst", "fast");
await writeFile(filename, broken);
const typescriptSource = `const count = 42;
// Workflow syntax colors
import { defineWorkflow, Effect, Schema } from "@openchart/workflow";
export default defineWorkflow({
  description: "Highlighting",
  args: Schema.Struct({}),
  run: () => Effect.succeed(count),
});
`;
await writeFile(join(workspace, "editor.workflow.ts"), typescriptSource);
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
const rendererOrigin = process.argv[2] || "openchart://app";
if (rendererOrigin !== "openchart://app")
  env.OPENCHART_DESKTOP_DEV_URL = rendererOrigin;
const application = await _electron.launch({
  args: [
    join(desktop, "dist"),
    `--user-data-dir=${join(profile, "browser")}`,
    `--openchart-home=${home}`,
    "--use-mock-keychain",
  ],
  env,
  timeout: 30_000,
});
const errors: string[] = [];
const pageErrors: string[] = [];
try {
  application
    .process()
    .stderr?.on("data", (chunk: Buffer) =>
      errors.push(
        chunk.toString().replace(/([?&]token=)[^&\s"']+/g, "$1[redacted]"),
      ),
    );
  const page = await application.firstWindow({ timeout: 30_000 });
  page.on("pageerror", (error) => {
    errors.push(error.message);
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(
        message.text().replace(/([?&]token=)[^&\s"']+/g, "$1[redacted]"),
      );
  });
  let connections = 0;
  let disconnect: (() => void) | undefined;
  await page.routeWebSocket(
    (url) => url.pathname === "/hose",
    (route) => {
      connections++;
      route.connectToServer();
      disconnect = () => {
        void route.close();
      };
    },
  );
  // The app may continue from /app to the last dashboard.
  await page.waitForURL(
    (url) =>
      url.origin === new URL(rendererOrigin).origin &&
      url.pathname.startsWith("/app"),
    { waitUntil: "load", timeout: 30_000 },
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(new URL("/app/workspaces", rendererOrigin).href);
  for (const name of ["default", "indicators", "builtin"])
    await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "sma.tea", exact: true }).click();
  const editor = page.locator(".monaco-editor:visible");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  // Check actual surfaces, including hidden tabs: a stale editor theme affects
  // the whole runtime even when the app's CSS and syntax highlighting look fine.
  const expectEditorTheme = async (dark: boolean) => {
    await expect(page.locator("html")).toHaveCSS(
      "color-scheme",
      dark ? "dark" : "light",
    );
    // Editors, not the overflow-widget layer that shares their class.
    const editors = page.locator(".monaco-editor:has(.margin)");
    await expect
      .poll(() =>
        editors.evaluateAll((editors) =>
          editors.map((editor) => ({
            background: getComputedStyle(editor).backgroundColor,
            gutter: getComputedStyle(editor.querySelector(".margin")!)
              .backgroundColor,
          })),
        ),
      )
      .toEqual(
        Array.from({ length: await editors.count() }, () => ({
          background: dark ? "rgb(30, 30, 30)" : "rgb(255, 255, 255)",
          gutter: dark ? "rgb(30, 30, 30)" : "rgb(255, 255, 255)",
        })),
      );
  };
  await expectEditorTheme(true);
  const builtin = join(workspace, "indicators/builtin/sma.tea");
  const original = await readFile(builtin, "utf8");
  await editor.click();
  await page.keyboard.insertText("FORBIDDEN_BUILTIN_EDIT");
  await expect(editor.locator(".view-lines")).not.toContainText(
    "FORBIDDEN_BUILTIN_EDIT",
  );
  await page.keyboard.press("ControlOrMeta+S");
  assert.equal(await readFile(builtin, "utf8"), original);
  await expect(page.getByRole("tab", { name: /sma.tea.*•/ })).toHaveCount(0);
  await page.getByRole("button", { name: "main.tea", exact: true }).click();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor.locator(".squiggly-error")).not.toHaveCount(0, {
    timeout: 15_000,
  });
  console.log("Tea LSP diagnostics received.");
  // A hover shows the name's docs next to the word, also when a host places
  // the editor with a CSS transform, as the dashboard grid does.
  const expectHoverBeside = async (
    line: string,
    word: string,
    text: string,
  ) => {
    const point = await editor.locator(".view-line").evaluateAll(
      (lines, { line, word }) => {
        for (const element of lines) {
          // Monaco renders spaces as no-break spaces; lengths are unchanged.
          const text = (element.textContent ?? "").replace(/\u00a0/g, " ");
          if (!text.includes(line)) continue;
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          let offset = 0;
          const target = text.indexOf(line) + line.indexOf(word) + 1;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const length = node.textContent?.length ?? 0;
            if (target < offset + length) {
              const range = document.createRange();
              range.setStart(node, target - offset);
              range.setEnd(node, target - offset + 1);
              const rect = range.getBoundingClientRect();
              return {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                top: rect.top,
                bottom: rect.bottom,
              };
            }
            offset += length;
          }
        }
        return null;
      },
      { line, word },
    );
    assert(point, `${word} is rendered`);
    await page.mouse.move(0, 0);
    await page.mouse.move(point.x, point.y);
    const hover = page.locator(".monaco-hover:visible");
    await expect(hover).toContainText(text, { timeout: 15_000 });
    const box = await hover.boundingBox();
    assert(box);
    assert(
      box.x <= point.x && point.x <= box.x + box.width,
      "hover spans the word",
    );
    assert(
      Math.min(
        Math.abs(box.y + box.height - point.top),
        Math.abs(box.y - point.bottom),
      ) < 12,
      `hover touches the word's line (box ${JSON.stringify(box)}, word ${JSON.stringify(point)})`,
    );
    await page.mouse.move(0, 0);
    return point;
  };
  const ema = await expectHoverBeside(
    "fast = ta.ema",
    "ema",
    "Exponential moving average",
  );
  await editor.evaluate((element) => {
    element.parentElement!.style.transform = "translate(120px, 90px)";
  });
  await expectHoverBeside("fast = ta.ema", "ema", "Exponential moving average");
  await editor.evaluate((element) => {
    element.parentElement!.style.transform = "";
  });
  console.log("Tea hover shows docs beside the word, also under a transform.");
  // A documented name offers the Tea reference, and ⌘ Click opens its entry;
  // F12 still goes to the source (library navigation below).
  await page.mouse.move(ema.x, ema.y);
  await expect(page.locator(".monaco-hover:visible")).toContainText(
    "Click to open in the Tea reference",
    { timeout: 15_000 },
  );
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.click(ema.x, ema.y);
  await page.keyboard.up("ControlOrMeta");
  const reference = page.getByRole("dialog");
  await expect(
    reference.getByRole("heading", { name: "ta.ema()" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(reference).toBeHidden();
  console.log("⌘ Click opens the Tea reference at the name's entry.");
  // Bracket coloring alone must not count as a working grammar/theme.
  type TokenPositions = Record<string, [number, number]> & {
    identifier: [number, number];
  };
  const teaTokens: TokenPositions = {
    identifier: [0, 0],
    keyword: [2, 0],
    string: [2, 6],
    number: [0, 21],
  };
  const expectSyntaxColors = (language: string, positions: TokenPositions) =>
    expect
      .poll(
        () =>
          editor.locator(".view-line").evaluateAll((lines, positions) => {
            const colorAt = (line: number, column: number) => {
              const element = lines[line];
              if (!element) return undefined;
              const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
              );
              let offset = 0;
              for (
                let node = walker.nextNode();
                node;
                node = walker.nextNode()
              ) {
                const length = node.textContent?.length ?? 0;
                if (column < offset + length)
                  return getComputedStyle(node.parentElement!).color;
                offset += length;
              }
              return undefined;
            };
            const identifier = colorAt(...positions.identifier);
            return Object.entries(positions)
              .filter(([token]) => token !== "identifier")
              .every(([, position]) => {
                const color = colorAt(...position);
                return !!identifier && !!color && color !== identifier;
              });
          }, positions),
        {
          message: `${language} tokens must be colored independently of brackets`,
        },
      )
      .toBe(true);
  await expectSyntaxColors("Tea", teaTokens);
  await expectEditorTheme(true);
  for (const dark of [false, true, false]) {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await expectEditorTheme(dark);
    await expectSyntaxColors("Tea", teaTokens);
  }
  await page
    .getByRole("button", { name: "editor.workflow.ts", exact: true })
    .click();
  await expect(editor.locator(".view-lines")).toContainText("const count");
  for (const dark of [true, false]) {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await expectEditorTheme(dark);
    await expectSyntaxColors("TypeScript workflow", {
      identifier: [0, 6],
      keyword: [0, 0],
      number: [0, 14],
      comment: [1, 0],
      import: [2, 9],
      string: [2, typescriptSource.split("\n")[2]!.indexOf('"')],
      function: [3, 15],
    });
  }
  console.log(
    "Workflow syntax, import and function colors verified in dark/light themes.",
  );
  await page.getByRole("tab", { name: "sma.tea", exact: true }).click();
  await expectEditorTheme(false);
  await page.getByRole("tab", { name: "main.tea", exact: true }).click();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(fixed);
  await expect(editor.locator(".squiggly-error")).toHaveCount(0, {
    timeout: 15_000,
  });
  const artifacts = join(desktop, ".artifacts");
  await mkdir(artifacts, { recursive: true });
  const bounds = await editor.boundingBox();
  assert(bounds);
  await page.screenshot({
    path: join(artifacts, "tea-highlighting.png"),
    clip: { ...bounds, height: Math.min(bounds.height, 160) },
  });
  assert.equal(
    await readFile(filename, "utf8"),
    broken,
    "LSP must not save edits",
  );
  assert(disconnect);
  disconnect();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(broken);
  await expect.poll(() => connections).toBe(2);
  await expect(editor.locator(".squiggly-error")).not.toHaveCount(0, {
    timeout: 15_000,
  });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(fixed);
  await expect(editor.locator(".squiggly-error")).toHaveCount(0, {
    timeout: 15_000,
  });
  await writeFile(filename, "external = missing\n");
  await expect(page.getByRole("tab", { name: /main.tea.*•/ })).toBeVisible();
  await expect(editor).toContainText('plot("fast", fast)');
  await page.keyboard.press("ControlOrMeta+S");
  await expect(
    page
      .locator('[data-sonner-toast][data-type="error"]')
      .filter({ hasText: "The file has changed" }),
  ).toBeVisible();
  await expect(editor).toContainText('plot("fast", fast)');
  await mkdir(join(desktop, ".artifacts"), { recursive: true });
  await page.screenshot({
    path: join(desktop, ".artifacts/sonner-save-failure.png"),
    animations: "disabled",
  });
  assert.equal(await readFile(filename, "utf8"), "external = missing\n");
  await writeFile(filename, broken);
  await page.keyboard.press("ControlOrMeta+S");
  await expect.poll(() => readFile(filename, "utf8")).toBe(fixed);
  await expect(
    page.getByRole("tab", { name: "main.tea", exact: true }),
  ).toBeVisible();
  await expect(editor.locator(".view-lines")).toContainText(
    "fast = ta.ema(close, 9)",
  );
  await editor.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home",
  );
  for (let column = 0; column < 11; column++)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.press("F12");
  await expect(page.getByRole("tab", { name: /ta.tea/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(editor.locator(".view-lines")).toContainText("export ema");
  await editor.click();
  await page.keyboard.insertText("FORBIDDEN_LIBRARY_EDIT");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Cannot edit in read-only editor" }),
  ).toBeVisible();
  await expect(editor.locator(".view-lines")).not.toContainText(
    "FORBIDDEN_LIBRARY_EDIT",
  );
  await expect(editor.locator(".view-lines")).toContainText("export ema");
  await page.getByRole("tab", { name: /main.tea/ }).click();
  await editor.click();

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("fast = ta.em");
  await expect(editor).toContainText("fast = ta.em");
  await page.keyboard.press("Control+Space");
  await expect(editor.locator(".suggest-widget.visible")).toBeVisible({
    timeout: 15_000,
  });
  await expect(editor.locator(".suggest-widget")).toContainText("ema");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(
    errors.filter((message) =>
      /Cannot add model|applyStateStackDiff/.test(message),
    ),
    [],
  );
  console.log(
    "Editor smoke passed: TypeScript/workflow and Tea syntax colors, read-only built-ins, dark startup, light/dark surfaces across new and hidden tabs, diagnostics, hover docs, ⌘ Click reference, reconnect, unsaved overlays, CAS saves, library navigation and completion.",
  );
} catch (error) {
  console.error(errors.filter((error) => !error.includes("Clerk")).join("\n"));
  throw error;
} finally {
  // Only this test's windows are destroyed; unsaved fixture edits must not
  // leave a native confirmation dialog blocking automated cleanup.
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    })
    .catch(() => {});
  await application.close();
  await rm(profile, { recursive: true, force: true });
}
