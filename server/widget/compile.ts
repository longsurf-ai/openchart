// Purpose: Check custom widget files against the bundled SDK and transpile saved snapshots for the renderer.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  CUSTOM_WIDGET_KIND,
  CUSTOM_WIDGET_TITLE_MAX,
} from "@openchart/server/resources/custom-widget/entity";

import { WidgetInvalid } from "./errors";

const directory = fileURLToPath(
  new URL("./.artifacts/widget-types/", import.meta.url),
);

type Modules = {
  readonly imports: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
};
let modules: Modules | undefined;
// Generated with the declarations (app/tooling/widget-types.ts), so the two always agree.
const readModules = () =>
  (modules ??= JSON.parse(
    readFileSync(join(directory, "modules.json"), "utf8"),
  ) as Modules);

const SHAPE =
  'Default-export defineWidget({ kind: "…", title: "…", Component }) with string literals for kind and title.';

const options: ts.CompilerOptions = {
  strict: true,
  noUncheckedIndexedAccess: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  ignoreDeprecations: "6.0",
  jsx: ts.JsxEmit.ReactJSX,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: [],
  skipLibCheck: true,
  inlineSourceMap: true,
  inlineSources: true,
};

/**
 * Checks one widget source snapshot with strict TypeScript against the bundled
 * SDK declarations, and reads its `kind` and `title` without running it.
 * Workspace configuration and installed packages never take part. Throws
 * {@link WidgetInvalid} with file/line/column diagnostics; writes nothing.
 * @example const { kind, title } = checkWidget(text, "/workspace/widgets/rates.widget.tsx");
 */
export function checkWidget(
  text: string,
  filename: string,
): { kind: string; title: string } {
  const { imports, dependencies } = readModules();
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  inspectImports(source, Object.keys(imports));
  const declaration = readDeclaration(source);
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (file, ...args) =>
    file === filename ? source : getSourceFile(file, ...args);
  // Widgets resolve only their imports; declarations also reach React's own dependencies.
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) => {
      const file =
        containingFile === filename
          ? imports[name]
          : (imports[name] ?? dependencies[name]);
      if (file)
        return {
          resolvedFileName: join(directory, file),
          extension: ts.Extension.Dts,
        };
      return containingFile === filename
        ? undefined
        : ts.resolveModuleName(name, containingFile, options, host)
            .resolvedModule;
    });
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length)
    throw new WidgetInvalid({
      message: ts.formatDiagnostics(diagnostics, {
        ...host,
        getCurrentDirectory: () => dirname(filename),
      }),
    });
  return declaration;
}

/**
 * Transpiles a checked snapshot to CommonJS with an inline source map.
 * Performs no type checking; {@link checkWidget} ran when it was saved.
 * @example const code = transpileWidget(snapshot, "widgets/rates.widget.tsx");
 */
export function transpileWidget(text: string, filename: string) {
  return ts.transpileModule(text, {
    compilerOptions: options,
    fileName: filename,
  }).outputText;
}

function invalid(source: ts.SourceFile, at: ts.Node | number, message: string) {
  const { line, character } = source.getLineAndCharacterOfPosition(
    typeof at === "number" ? at : at.getStart(source),
  );
  return new WidgetInvalid({
    message: `${source.fileName.split("/").pop()}(${line + 1},${character + 1}): ${message}`,
  });
}

function inspectImports(source: ts.SourceFile, allowed: readonly string[]) {
  if (
    source.referencedFiles.length ||
    source.typeReferenceDirectives.length ||
    source.libReferenceDirectives.length
  )
    throw new WidgetInvalid({
      message: "Widget files may not use /// reference directives.",
    });
  // Suppressed diagnostics would let code the check never saw go live.
  const suppression = /@ts-(?:nocheck|ignore|expect-error)\b/.exec(source.text);
  if (suppression)
    throw invalid(
      source,
      suppression.index,
      `Widget files may not suppress type errors with ${suppression[0]}.`,
    );
  const inspect = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      (!ts.isStringLiteral(node.moduleSpecifier) ||
        !allowed.includes(node.moduleSpecifier.text))
    )
      throw invalid(
        source,
        node,
        `Widget files may import only ${allowed.join(", ")}.`,
      );
    if (
      ts.isImportEqualsDeclaration(node) ||
      ts.isImportTypeNode(node) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require")))
    )
      throw invalid(
        source,
        node,
        `Use static imports from ${allowed.join(", ")}.`,
      );
    ts.forEachChild(node, inspect);
  };
  inspect(source);
}

function readDeclaration(source: ts.SourceFile) {
  const exported = source.statements.find(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  const call = exported?.expression;
  const argument =
    call &&
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "defineWidget"
      ? call.arguments[0]
      : undefined;
  if (!argument || !ts.isObjectLiteralExpression(argument))
    throw exported
      ? invalid(source, exported, SHAPE)
      : new WidgetInvalid({ message: SHAPE });
  const literal = (name: string) => {
    const property = argument.properties.find(
      (item): item is ts.PropertyAssignment =>
        ts.isPropertyAssignment(item) &&
        ts.isIdentifier(item.name) &&
        item.name.text === name,
    );
    if (!property || !ts.isStringLiteralLike(property.initializer))
      throw invalid(source, property ?? argument, SHAPE);
    return { node: property.initializer, text: property.initializer.text };
  };
  const kind = literal("kind");
  if (!CUSTOM_WIDGET_KIND.test(kind.text))
    throw invalid(
      source,
      kind.node,
      "kind must be lowercase letters, digits and hyphens, start with a letter and have at most 64 characters.",
    );
  const title = literal("title");
  if (!title.text.trim() || title.text.length > CUSTOM_WIDGET_TITLE_MAX)
    throw invalid(
      source,
      title.node,
      `title must be non-blank and at most ${CUSTOM_WIDGET_TITLE_MAX} characters.`,
    );
  return { kind: kind.text, title: title.text };
}
