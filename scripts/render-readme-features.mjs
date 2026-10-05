// Purpose: Export website feature visuals; the native Charts demo has its own renderer.
// Run from the repository root with workspace dependencies, Playwright Chromium, curl, and ffmpeg:
// just --command node scripts/render-readme-features.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "docs/assets");
const work = mkdtempSync(path.join(tmpdir(), "openchart-readme-features-"));
const origin = "https://openchart.co";
const agentsOnly = process.argv.includes("--agents-only");
const { chromium } = createRequire(
  path.join(root, "platform/desktop/package.json"),
)("@playwright/test");

const download = (url, output) =>
  execFileSync("curl", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--user-agent",
    "Mozilla/5.0",
    "--output",
    output,
    url,
  ]);

// Preserve the website's pacing. Alert clips end before the illustrative brokerage actions.
const films = [
  { page: "btc-drawing-film", name: "feature-drawing-alert", end: 23.6 },
  { page: "supply-chain-film", name: "feature-market-watch", end: 29.2 },
  { page: "select-explain-film", name: "feature-explain", end: 19.9 },
];

try {
  for (const film of agentsOnly ? [] : films) {
    // Skip the opening fade so image-only clients also get a useful first frame.
    const start = 0.35;
    const duration = film.end - start;
    const page = path.join(work, `${film.page}.html`);
    download(`${origin}/${film.page}/`, page);
    const source = readFileSync(page, "utf8").match(
      /<video\b[^>]*\bsrc="([^"]+)"/,
    )?.[1];
    if (!source) throw new Error(`Missing video on ${film.page}`);
    const video = path.join(work, `${film.name}.mp4`);
    const sourceUrl = new URL(source, origin).href;
    download(sourceUrl, video);
    const output = path.join(assets, `${film.name}.gif`);
    const closing =
      film.page === "select-explain-film"
        ? ""
        : `,tpad=stop_mode=clone:stop_duration=0.8,fade=t=out:st=${duration + 0.5}:d=0.3:color=0x10130f`;
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-i",
        video,
        "-t",
        String(duration + (closing ? 0.8 : 0)),
        "-vf",
        `trim=start=${start}:end=${film.end},setpts=PTS-STARTPTS${closing},fps=12,scale=640:640:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
        "-loop",
        "0",
        output,
      ],
      { stdio: "inherit" },
    );
    console.log(
      `${path.basename(output)}: ${statSync(output).size} bytes; ${sourceUrl}`,
    );
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.locator("#agents").scrollIntoViewIfNeeded();
    await page.locator('#agents img[src*="codex"]').first().waitFor();
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#agents")
          .closest("astro-island")
          ?.hasAttribute("ssr"),
    );
    await page.evaluate(() => document.fonts.ready);
    // Keep the website's model-list composition, but use the same square canvas as the films.
    const agentFrame = page.locator("#agents .aspect-square");
    await agentFrame.evaluate((element) => {
      element.style.width = "640px";
      element.style.height = "640px";
    });
    // Extend the existing floating list with the Gemini glyph from openchart-cloud.
    // Use model-family labels so this illustration does not invent release versions.
    const geminiIcon = `data:image/svg+xml;base64,${readFileSync(path.join(assets, "gemini-mark.svg")).toString("base64")}`;
    await agentFrame.evaluate((element, icon) => {
      if (element.querySelector('ul[aria-label="Gemini models"]')) return;
      const template = element.querySelector('ul[aria-label="Codex models"]');
      if (!template)
        throw new Error("The website's Codex model list is missing");
      const group = template.parentElement.cloneNode(true);
      group.firstElementChild.firstElementChild.textContent = "Gemini";
      const list = group.querySelector("ul");
      list.setAttribute("aria-label", "Gemini models");
      const row = list.firstElementChild.cloneNode(true);
      list.replaceChildren();
      for (const label of ["Gemini Pro", "Gemini Flash"]) {
        const item = row.cloneNode(true);
        const mark = item.querySelector("img");
        mark.src = icon;
        item.replaceChildren(mark, document.createTextNode(label));
        list.append(item);
      }
      template.parentElement.parentElement.append(group);
      for (const node of element.querySelectorAll("div")) {
        for (const child of node.childNodes) {
          if (
            child.nodeType === Node.TEXT_NODE &&
            child.textContent.trim() === "Claude or Codex"
          ) {
            child.textContent = "Claude, Codex or Gemini ";
          }
        }
      }
    }, geminiIcon);
    await agentFrame.locator('ul[aria-label="Gemini models"]').waitFor();
    await agentFrame
      .locator("img")
      .evaluateAll((images) =>
        Promise.all(images.map((image) => image.decode())),
      );
    await agentFrame.screenshot({
      path: path.join(assets, "feature-agents.png"),
    });

    const sources = agentsOnly
      ? {}
      : await page.locator("img").evaluateAll((images) => ({
          tea: images.find((image) => image.alt.startsWith("Dark Tea editor"))
            ?.src,
        }));
    for (const [name, source] of Object.entries(sources)) {
      if (!source) throw new Error(`Missing ${name} visual on the homepage`);
      const input = path.join(work, `${name}.webp`);
      download(source, input);
      const frame = await browser.newPage({
        viewport: { width: 640, height: 640 },
      });
      await frame.setContent(`<!doctype html><html><head><style>
        * { box-sizing: border-box; }
        body { margin: 0; width: 640px; height: 640px; display: grid; place-items: center; background: #0b1218; }
        img { display: block; width: 100%; height: 100%; object-fit: contain; }
      </style></head><body><img alt="${name}" src="data:image/webp;base64,${readFileSync(input).toString("base64")}"></body></html>`);
      await frame.locator("img").evaluate((image) => image.decode());
      await frame.screenshot({
        path: path.join(assets, `feature-${name}.png`),
      });
      await frame.close();
      console.log(`feature-${name}.png: ${source}`);
    }
  } finally {
    await browser.close();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
