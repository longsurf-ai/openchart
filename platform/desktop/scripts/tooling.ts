// Purpose: Build the host, backend, preload and shared renderer bundles, run Electron with Vite, and package only generated desktop files.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { cp, glob, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { notificationSounds } from "@openchart/notification";
import { build, createServer, loadEnv, type Plugin, type Rollup } from "vite";
import { z } from "zod";

import { generateWorkflowTypes } from "@openchart/server/agent/workflow/generate-workflow-types";
import metadata from "@openchart/desktop/package.json" with { type: "json" };
import { createRelease, releaseBaseUrl, signingIdentity } from "./release.ts";
import { copyDocumentation } from "./documentation.ts";
import { rendererConfig } from "./renderer-config.ts";

const require = createRequire(import.meta.url);
const directory = dirname(require.resolve("@openchart/desktop/package.json"));
const appDirectory = dirname(require.resolve("@openchart/app/package.json"));
const serverDirectory = dirname(require.resolve("@openchart/server"));
const teaCompiler = createRequire(require.resolve("@openchart/server")).resolve(
  "tea/compiler",
);
const staging = join(directory, "dist");
const documentationStaging = join(directory, ".artifacts/docs");
const nodeExternal = [/^node:/, ...builtinModules, "electron"];
const runtimePackages = ["ws", "@anthropic-ai/claude-agent-sdk", "typescript"];

async function main() {
  const command = z
    .enum(["dev", "build", "package", "release"])
    .parse(process.argv[2]);
  // `dev` accepts only the test-account option; builds take an environment.
  const testAccount =
    command === "dev" &&
    z.literal("test-account").optional().parse(process.argv[3]) !== undefined;
  const environment = z
    .enum(["development", "production"])
    .parse(
      command === "dev" ? "development" : (process.argv[3] ?? "production"),
    );
  const development = environment === "development";
  if (
    command === "release" &&
    (development || process.platform !== "darwin" || process.arch !== "arm64")
  )
    throw new Error(
      "Releases require a production build on Apple Silicon macOS",
    );
  const mode = development ? "development" : "production";
  process.env.NODE_ENV = mode;
  const keyError = `VITE_APP_CLERK_PUBLISHABLE_KEY must be a ${development ? "pk_test_" : "pk_live_"} publishable key for ${mode} builds.`;
  const { VITE_APP_CLERK_PUBLISHABLE_KEY: publishableKey } = z
    .object({
      VITE_APP_CLERK_PUBLISHABLE_KEY: z
        .string({ error: keyError })
        .regex(
          development
            ? /^pk_test_[A-Za-z0-9+/=]+$/
            : /^pk_live_[A-Za-z0-9+/=]+$/,
          keyError,
        ),
    })
    .parse(loadEnv(mode, appDirectory, "VITE_APP_"));
  await buildDesktopRuntime(development, publishableKey);
  // Tailwind's content paths are relative to the shared app's directory.
  process.chdir(appDirectory);
  if (command === "dev") return runDevelopment(testAccount);
  await buildRenderer();
  if (command === "package" || command === "release") {
    const executable = await packageApplication(development);
    if (command === "release")
      await createRelease(
        dirname(dirname(dirname(executable))),
        metadata.version,
      );
  }
}

async function buildDesktopRuntime(
  development: boolean,
  publishableKey: string,
) {
  await rm(staging, { recursive: true, force: true });
  await copyDocumentation(dirname(dirname(teaCompiler)), documentationStaging);
  await buildMain(development, publishableKey);
  await buildBackend();
  await buildPreload();
  // Every command produces a self-contained runtime, including desktop-build.
  await copyRuntimePackages();
  await mkdir(staging, { recursive: true });
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify(
      {
        name: "openchart-desktop",
        productName: "OpenChart",
        version: metadata.version,
        type: "module",
        main: "main/main.js",
      },
      null,
      2,
    ),
  );
}

async function buildMain(development: boolean, publishableKey: string) {
  await build({
    configFile: false,
    define: {
      "process.env.OPENCHART_DESKTOP_BUILD": JSON.stringify(
        development ? "development" : "production",
      ),
      "process.env.OPENCHART_CLERK_PUBLISHABLE_KEY":
        JSON.stringify(publishableKey),
      "process.env.OPENCHART_UPDATE_URL": JSON.stringify(releaseBaseUrl),
    },
    build: {
      target: "node24",
      outDir: join(staging, "main"),
      emptyOutDir: true,
      lib: {
        entry: join(directory, "src/main.ts"),
        formats: ["es"],
        fileName: () => "main.js",
      },
      rollupOptions: { external: nodeExternal, onwarn },
    },
  });
  await copyOnboardingContent();
}

async function copyOnboardingContent() {
  for (const filename of [
    "onboarding-content-schema.sql",
    "onboarding-content.sql",
  ])
    await cp(
      join(directory, "src/onboarding/content", filename),
      join(staging, "main", filename),
    );
}

async function buildBackend() {
  // The backend runs the whole server in one Node bundle; only packages that
  // resolve files or binaries at runtime stay external and ship in node_modules.
  const serverTextAssets: Plugin = {
    name: "server-text-assets",
    async buildStart() {
      const declarations = await generateWorkflowTypes();
      for (const file of declarations.watchFiles) this.addWatchFile(file);
      for (const { fileName, content } of declarations.files)
        this.emitFile({
          type: "asset",
          fileName: `.artifacts/workflow-types/${fileName}`,
          source: content,
        });
      for await (const file of glob("indicators/builtins/*.tea", {
        cwd: serverDirectory,
      }))
        this.emitFile({
          type: "asset",
          fileName: `builtins/${basename(file)}`,
          source: await readFile(join(serverDirectory, file)),
        });
      for await (const file of glob("agent/workflow/templates/*.workflow.ts", {
        cwd: serverDirectory,
      }))
        this.emitFile({
          type: "asset",
          fileName: `templates/${basename(file)}`,
          source: await readFile(join(serverDirectory, file)),
        });
      // Prompt segments are read beside the compiled module with import.meta.url.
      for await (const file of glob("agent/**/*.txt", { cwd: serverDirectory }))
        this.emitFile({
          type: "asset",
          fileName: basename(file),
          source: await readFile(join(serverDirectory, file)),
        });
    },
  };
  await build({
    configFile: false,
    plugins: [serverTextAssets],
    resolve: { conditions: ["node"] },
    ssr: { noExternal: true },
    build: {
      target: "node24",
      outDir: join(staging, "main"),
      emptyOutDir: false,
      ssr: join(directory, "src/backend-entry.ts"),
      ssrEmitAssets: true,
      rollupOptions: {
        onwarn,
        external: [...nodeExternal, ...runtimePackages],
        output: {
          format: "es",
          entryFileNames: "backend.js",
          // One file: migrations and other lazy imports need no sibling chunks.
          inlineDynamicImports: true,
        },
      },
    },
  });
  // Logo metadata and images stay out of JavaScript and are read beside the backend.
  await cp(
    join(serverDirectory, "data/providers/local/logos/assets"),
    join(staging, "main/assets"),
    {
      recursive: true,
    },
  );
  // Tea is bundled with the server; its loader still reads ../tea-lib at runtime.
  await cp(join(dirname(teaCompiler), "tea-lib"), join(staging, "tea-lib"), {
    recursive: true,
  });
}

async function buildPreload() {
  await build({
    configFile: false,
    build: {
      target: "node24",
      outDir: join(staging, "preload"),
      emptyOutDir: true,
      lib: {
        entry: join(directory, "src/preload.ts"),
        // Sandboxed preloads must be CommonJS.
        formats: ["cjs"],
        fileName: () => "preload.cjs",
      },
      rollupOptions: { external: ["electron"], onwarn },
    },
  });
}

async function runDevelopment(testAccount: boolean) {
  const vite = await createServer({
    ...rendererConfig(),
    // Vite 5 treats port 0 as its shared 5173 default, not an ephemeral port.
    server: { host: "127.0.0.1", port: 43875, strictPort: false, open: false },
  });
  try {
    await vite.listen();
    vite.printUrls();
    const address = vite.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("Vite did not bind a TCP port");
    const { executable, args } = await prepareDevelopmentHost(testAccount);
    await runElectron(executable, args, `http://127.0.0.1:${address.port}`);
  } finally {
    await vite.close();
  }
}

async function prepareDevelopmentHost(testAccount: boolean) {
  // Keep the singleton, browser storage and application home local to this
  // checkout and outside rebuilt bundles on every OS. The test account gets
  // its own profile so it never mixes with the developer's signed-in account.
  const profile = join(
    directory,
    testAccount
      ? ".artifacts/dev-profile-test-account"
      : ".artifacts/dev-profile",
  );
  const args = [
    `--user-data-dir=${profile}`,
    `--openchart-home=${join(profile, "home")}`,
  ];
  if (testAccount) args.push("--openchart-test-account");
  console.log("Desktop development profile:", profile);
  const executable = await packageApplication(true);
  // This development-only profile never contains real-Keychain ciphertext.
  if (process.platform === "darwin") args.unshift("--use-mock-keychain");
  return { executable, args };
}

async function runElectron(executable: string, args: string[], devUrl: string) {
  const env = { ...process.env };
  // Editors built with Electron can export this flag to their terminals.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const child = spawn(executable, args, {
    // Repackaging replaces the app bundle; native providers need a surviving cwd.
    cwd: directory,
    stdio: "inherit",
    env: {
      ...env,
      OPENCHART_DESKTOP_DEV_URL: devUrl,
    },
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  const [code] = await once(child, "exit");
  process.exitCode = typeof code === "number" ? code : 1;
}

async function buildRenderer() {
  await build({
    ...rendererConfig(),
    build: {
      outDir: join(staging, "renderer"),
      emptyOutDir: true,
      rollupOptions: { onwarn },
    },
  });
}

async function packageApplication(development: boolean) {
  const name = development ? "OpenChart Development" : "OpenChart";
  // @agent invariant: Development and release execute the same packaged runtime
  // layout on every platform. Only app identity and output location vary here.
  const [bundle] = await packager({
    dir: staging,
    // Packager clears its temporary root; isolate worktrees and release versions.
    tmpdir: join(
      directory,
      ".artifacts/packager",
      development ? "development" : metadata.version,
    ),
    out: join(
      directory,
      development ? ".artifacts/dev" : `out/${metadata.version}`,
    ),
    name,
    icon:
      process.platform === "darwin"
        ? join(directory, "assets/icon.icns")
        : undefined,
    appBundleId: development
      ? "ai.longsurf.openchart.development"
      : "ai.longsurf.openchart",
    electronVersion: metadata.devDependencies.electron,
    protocols: [
      {
        name: `${name} sign in`,
        schemes: [development ? "openchart-dev" : "openchart"],
      },
    ],
    asar: true,
    // UNNotificationSound searches the main bundle, not Electron's ASAR archive.
    extraResource: [
      ...notificationSounds.map((sound) => fileURLToPath(sound.url)),
      documentationStaging,
    ],
    osxSign:
      process.platform === "darwin"
        ? {
            identity: development ? "-" : signingIdentity,
            identityValidation: !development,
            preAutoEntitlements: false,
            continueOnError: false,
            optionsForFile: (file) =>
              file.endsWith(".app")
                ? {
                    entitlements: [
                      "com.apple.security.cs.allow-jit",
                      // Ad-hoc development apps cannot match their frameworks' Team ID.
                      ...(development
                        ? ["com.apple.security.cs.disable-library-validation"]
                        : []),
                    ],
                  }
                : {},
          }
        : undefined,
    osxNotarize:
      process.platform === "darwin" && !development
        ? { keychainProfile: "openchart-notary" }
        : undefined,
    prune: false,
    overwrite: true,
  });
  if (!bundle) throw new Error("Electron Packager produced no application");
  console.log("Packaged OpenChart:", bundle);
  return process.platform === "darwin"
    ? join(bundle, `${name}.app`, "Contents/MacOS", name)
    : join(bundle, `${name}${process.platform === "win32" ? ".exe" : ""}`);
}

async function copyRuntimePackages() {
  const copied = new Set<string>();
  async function copyPackage(name: string, parent: string) {
    if (copied.has(name)) return;
    let source = dirname(createRequire(parent).resolve(name));
    while (!existsSync(join(source, "package.json"))) source = dirname(source);
    const manifest = z
      .object({
        dependencies: z.record(z.string(), z.string()).optional(),
      })
      .parse(JSON.parse(await readFile(join(source, "package.json"), "utf8")));
    await cp(source, join(staging, "node_modules", name), {
      recursive: true,
      dereference: true,
      filter: (filename) =>
        !filename.slice(source.length).split(/[/\\]/).includes("node_modules"),
    });
    copied.add(name);
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      await copyPackage(dependency, join(source, "package.json"));
  }
  for (const name of runtimePackages) await copyPackage(name, import.meta.url);
}

const onwarn: Rollup.WarningHandlerWithDefault = (warning, warn) => {
  // Zod's explanatory comments mention PURE annotations as prose.
  if (
    warning.code === "INVALID_ANNOTATION" &&
    /[/\\]node_modules[/\\]zod[/\\]v4[/\\]core[/\\](util|regexes)\.js$/.test(
      warning.id ?? "",
    )
  )
    return;
  warn(warning);
};

await main();
