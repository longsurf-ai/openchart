// Purpose: Render the Trellis starter films from app/src/app/trellis/workflows/starter/films/index.html.
// Usage from the repository root: just --command node scripts/render-trellis-films.mjs [--stills]
// Requires installed workspace dependencies, ffmpeg on PATH, and Playwright's Chromium:
// just --command npm --prefix platform/desktop exec -- playwright install chromium --only-shell
// --stills exports only each shot's checkpoint frame, named by its manifest ID, to a new
// directory under the OS temp directory; without it both MP4s are written beside workflow.ts.
import { spawn } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const starter = path.join(root, "app/src/app/trellis/workflows/starter");
const source = pathToFileURL(path.join(starter, "films/index.html"));
const { chromium } = createRequire(
  path.join(root, "platform/desktop/package.json"),
)("@playwright/test");
const stills = process.argv.includes("--stills")
  ? mkdtempSync(path.join(tmpdir(), "openchart-trellis-films-"))
  : undefined;

/** Pipes 1600px PNG frames through FFmpeg, downsampled to the manifest's output size. */
function encoder(output, size, fps, args) {
  const ffmpeg = spawn(
    "ffmpeg",
    [
      ...[
        "-v",
        "error",
        "-y",
        "-f",
        "image2pipe",
        "-framerate",
        fps,
        "-i",
        "-",
      ],
      ...["-vf", `scale=${size}:${size}:flags=lanczos`, ...args, output],
    ].map(String),
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise((resolve, reject) =>
    ffmpeg.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    ),
  );
  return {
    write: (frame) =>
      new Promise((resolve) =>
        ffmpeg.stdin.write(frame)
          ? resolve()
          : ffmpeg.stdin.once("drain", resolve),
      ),
    end: () => (ffmpeg.stdin.end(), done),
  };
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 800 },
    deviceScaleFactor: 2,
  });
  for (const id of ["chart-controls", "agent-indicator"]) {
    await page.goto(`${source}?film=${id}&render`);
    await page.evaluate(() => window.ready);
    const {
      fps,
      output: size,
      duration,
      rushed,
      checkpoints,
    } = await page.evaluate(() => window.film);
    if (rushed.length) throw new Error(`${id} rushes the pointer: ${rushed}`);
    const frame = async (index) => {
      await page.evaluate((t) => window.renderAt(t), index / fps);
      return page.locator("#stage").screenshot();
    };
    if (stills) {
      for (const { id: shot, frame: index } of checkpoints) {
        const still = encoder(path.join(stills, `${shot}.png`), size, fps, []);
        await still.write(await frame(index));
        await still.end();
      }
      continue;
    }
    const output = path.join(starter, `${id}.mp4`);
    const video = encoder(output, size, fps, [
      ...["-c:v", "libx264", "-preset", "slow", "-crf", 18],
      ...["-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"],
    ]);
    const count = Math.round(duration * fps);
    for (let index = 0; index < count; index++)
      await video.write(await frame(index));
    await video.end();
    console.log(
      `${path.relative(root, output)}: ${statSync(output).size} bytes, ${count} frames at ${fps} fps`,
    );
  }
} finally {
  await browser.close();
}
if (stills) console.log(`Checkpoint stills: ${stills}`);
