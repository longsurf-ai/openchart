// Purpose: Render the README hero using the app's fonts, logo, and user-supplied Desktop screenshot.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../platform/desktop/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const source = new URL("../docs/assets/readme-hero.html", import.meta.url);
const output = fileURLToPath(
  new URL("../docs/assets/readme-hero.png", import.meta.url),
);
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1200 },
  });
  await page.goto(source.href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  await page.locator("main").screenshot({ path: output });
  console.log(`Rendered ${output}`);
} finally {
  await browser.close();
}
