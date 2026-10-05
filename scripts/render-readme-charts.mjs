// Renders docs/assets/charts-animation.html to docs/assets/feature-charts.gif.
// Usage from the repository root: just --command node scripts/render-readme-charts.mjs
// Requires installed workspace dependencies, ffmpeg on PATH, and Playwright's Chromium:
// just --command npm --prefix platform/desktop exec -- playwright install chromium --only-shell
// The review contact sheet is written to a new directory under the OS temp directory.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(
  path.join(root, "platform/desktop/package.json"),
)("@playwright/test");
const source = path.join(root, "docs/assets/charts-animation.html");
const output = path.join(root, "docs/assets/feature-charts.gif");
const work = mkdtempSync(path.join(tmpdir(), "openchart-readme-charts-"));
const frames = path.join(work, "frames");
const contactSheet = path.join(work, "contact-sheet.png");
// Capture the authored viewport without adding a square letterbox.
const [width, fps] = [800, 20];
let height;
let count;
let timeScale;

mkdirSync(frames);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 960 },
    deviceScaleFactor: 2,
  });
  await page.goto(`${pathToFileURL(source)}?render`);
  await page.evaluate(() => window.ready);
  const bounds = await page.locator("#stage").boundingBox();
  height = Math.round((width * bounds.height) / bounds.width);
  const timing = await page.evaluate(() => window.animationTiming);
  count = Math.round(fps * timing.duration);
  timeScale = timing.duration / timing.timelineDuration;
  for (let index = 0; index < count; index++) {
    await page.evaluate((t) => window.renderAt(t), index / fps);
    await page.locator("#stage").screenshot({
      path: path.join(frames, `${String(index).padStart(4, "0")}.png`),
    });
  }
} finally {
  await browser.close();
}

const ffmpeg = (...args) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args.map(String)], {
    stdio: "inherit",
  });
ffmpeg(
  "-framerate",
  fps,
  "-i",
  path.join(frames, "%04d.png"),
  "-vf",
  `scale=${width}:${height}:flags=area,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
  "-loop",
  0,
  output,
);
rmSync(frames, { recursive: true });

// Review sheet: opening, Indicators click, Add to chart click, bands, chart-type
// menu, Volume Profile click, profile reveal and result, 16 click, mid-transition,
// final grid, and loop reset.
const review = [0, 22, 35, 46, 62, 69, 78, 86, 103, 112, 130].map((frame) =>
  Math.round(frame * timeScale),
);
review.push(count - 1);
ffmpeg(
  "-i",
  output,
  "-vf",
  `select='${review.map((n) => `eq(n,${n})`).join("+")}',scale=${width / 2}:-1,tile=3x4:padding=8:color=white`,
  "-frames:v",
  1,
  contactSheet,
);
console.log(
  `${path.relative(root, output)}: ${statSync(output).size} bytes, ${count} frames at ${fps} fps`,
);
console.log(`Contact sheet: ${contactSheet}`);
