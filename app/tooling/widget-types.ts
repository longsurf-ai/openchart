// Purpose: Generate the custom widget SDK declarations shared by the server compiler and Monaco.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import type { Plugin } from "vite";

/**
 * What widget files may import, each with its declaration file. The renderer's
 * module table provides exactly these specifiers; a test keeps them equal.
 */
export const widgetImports = {
  "@openchart/widget": "widget.d.ts",
  react: "react/index.d.ts",
  "react/jsx-runtime": "react/jsx-runtime.d.ts",
  "vega-embed": "vega-embed/index.d.ts",
} as const;

// React's declarations import these; widget files may not.
const declarationDependencies = {
  csstype: "csstype/index.d.ts",
  "prop-types": "prop-types/index.d.ts",
} as const;

// ponytail: the spec stays a plain object; adopt vega-lite's TopLevelSpec when widgets need spec completion.
const vegaEmbed = `/** Render a Vega or Vega-Lite spec into an element. Call \`finalize()\` on unmount. */
export default function embed(
  element: HTMLElement,
  spec: object,
  options?: { actions?: boolean; renderer?: "canvas" | "svg"; theme?: string },
): Promise<{ view: unknown; finalize(): void }>;
`;

/**
 * Bundles the SDK's declarations into one file beside React's own, so the
 * server and Monaco check widget files against exactly what the renderer
 * provides. `modules.json` maps every specifier to its file: `imports` are
 * what widgets may import, `dependencies` only resolve inside declarations.
 * Nothing executes; React stays separate because widgets import it directly.
 */
async function generateWidgetTypes() {
  const bundle = await rollup({
    // The key names the chunk, and rollup-plugin-dts writes that name into its
    // self-augmentations, so it must stay widgetImports["@openchart/widget"].
    input: {
      widget: fileURLToPath(
        new URL("../src/app/widgets/custom/sdk.ts", import.meta.url),
      ),
    },
    external: (id) => id === "react" || id.startsWith("react/"),
    plugins: [
      dts({
        tsconfig: fileURLToPath(
          new URL("../../tsconfig.json", import.meta.url),
        ),
        respectExternal: true,
        compilerOptions: { incremental: false, preserveSymlinks: false },
      }),
    ],
    // Arrow's declarations name Node stream modules widgets never use.
    onwarn: (warning, warn) => {
      if (warning.code !== "UNRESOLVED_IMPORT") warn(warning);
    },
  });
  try {
    const [sdk] = (await bundle.generate({ format: "es" })).output;
    const react = dirname(
      createRequire(import.meta.url).resolve("@types/react/package.json"),
    );
    const fromReact = createRequire(join(react, "package.json"));
    const copies = {
      [widgetImports.react]: join(react, "index.d.ts"),
      "react/global.d.ts": join(react, "global.d.ts"),
      [widgetImports["react/jsx-runtime"]]: join(react, "jsx-runtime.d.ts"),
      [declarationDependencies.csstype]:
        fromReact.resolve("csstype/index.d.ts"),
      [declarationDependencies["prop-types"]]: fromReact.resolve(
        "@types/prop-types/index.d.ts",
      ),
    };
    const copied = await Promise.all(
      Object.entries(copies).map(async ([fileName, source]) => ({
        fileName,
        content: await readFile(source, "utf8"),
      })),
    );
    return {
      files: [
        { fileName: sdk.fileName, content: sdk.code },
        ...copied,
        { fileName: widgetImports["vega-embed"], content: vegaEmbed },
        {
          fileName: "modules.json",
          content: JSON.stringify({
            imports: widgetImports,
            dependencies: declarationDependencies,
          }),
        },
      ],
    };
  } finally {
    await bundle.close();
  }
}

/**
 * Writes the declarations beside the server's widget compiler for tests.
 * Desktop emits the same files beside its backend bundle instead.
 * @example await writeWidgetTypes();
 */
export default async function writeWidgetTypes() {
  const directory = fileURLToPath(
    new URL("../../server/widget/.artifacts/widget-types/", import.meta.url),
  );
  const { files } = await generateWidgetTypes();
  await Promise.all(
    files.map(async ({ fileName, content }) => {
      const target = join(directory, fileName);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
}

const moduleId = "virtual:widget-types";
const resolvedId = `\0${moduleId}`;

/**
 * Generates the widget SDK declaration files in a child process. The roll-up's
 * TypeScript program spans the app; inside a bundler's process it pushes
 * Desktop builds past the default heap, so Vite and Desktop tooling call this.
 * @example const { files } = await generateWidgetTypesInChild();
 */
export async function generateWidgetTypesInChild(): Promise<
  Awaited<ReturnType<typeof generateWidgetTypes>>
> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [fileURLToPath(import.meta.url)],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

/**
 * Supplies the same declarations to the lazy Monaco editor as text, with
 * `paths` for every specifier, generated in a child process so the bundler's
 * heap never holds the TypeScript program. They are generated once per
 * dev-server session, like the server checker's copy, which refreshes only on
 * restart. No files reach user workspaces.
 * @example plugins: [widgetTypes()]
 */
export function widgetTypes(): Plugin {
  return {
    name: "widget-types",
    resolveId: (id) => (id === moduleId ? resolvedId : undefined),
    async load(id) {
      if (id !== resolvedId) return;
      const { files } = await generateWidgetTypesInChild();
      const uri = (file: string) => `file:///widget-types/${file}`;
      return `export default ${JSON.stringify({
        paths: Object.fromEntries(
          Object.entries({ ...widgetImports, ...declarationDependencies }).map(
            ([name, file]) => [name, [uri(file)]],
          ),
        ),
        files: files
          .filter(({ fileName }) => fileName.endsWith(".d.ts"))
          .map(({ fileName, content }) => ({
            filePath: uri(fileName),
            content,
          })),
      })};`;
    },
  };
}

// Run directly (`node widget-types.ts`), print the generated declarations for the plugin above.
if (process.argv[1] === fileURLToPath(import.meta.url))
  process.stdout.write(JSON.stringify(await generateWidgetTypes()));
