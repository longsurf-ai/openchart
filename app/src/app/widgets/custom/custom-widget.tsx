// Purpose: Run saved custom widgets in dashboard cards: resolve the kind, load its code and evaluate it against the module table.
import { useQuery } from "@tanstack/react-query";
import { Blocks } from "lucide-react";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { ErrorBoundary } from "react-error-boundary";

import { ResourceNotice } from "@openchart/app/features/chart/components/resource-notice";
import { useWidget } from "@openchart/app/hooks/use-widget";
import { ChartSelectionContext } from "@openchart/app/lib/chart/selection";
import { customWidgetCode } from "@openchart/app/lib/resource/custom-widget";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";

import * as sdk from "./sdk";
import { readsSymbol } from "./symbol";

/** Dashboards place a saved widget as `custom:<kind>`. */
export const CUSTOM_WIDGET_PREFIX = "custom:";

/**
 * Everything widget code may import, by specifier. The server checks widgets
 * against declarations generated for exactly these (app/tooling/widget-types.ts).
 * ponytail: the whole table loads with the first custom widget (dynamic imports
 * keep it out of the startup bundle); bring back per-widget import lists when
 * the table gains a heavy library most widgets skip.
 */
export const widgetModules: Readonly<
  Record<string, () => object | Promise<object>>
> = {
  "@openchart/widget": () => sdk,
  react: () => React,
  "react/jsx-runtime": () => jsxRuntime,
  "vega-embed": () => import("vega-embed"),
};

/**
 * Run transpiled widget code against the whole module table, marked as ES
 * modules for TypeScript's interop helpers. Saved widget code is trusted like
 * workflow programs: it runs in the app, unsandboxed. Throws when the code
 * requires a module outside the table or its default export has no Component.
 * @example const widget = await evaluateWidget(code, "rates");
 */
export async function evaluateWidget(
  code: string,
  kind: string,
): Promise<sdk.CustomWidget> {
  const modules = new Map<string, object>();
  for (const [specifier, load] of Object.entries(widgetModules))
    modules.set(specifier, { ...(await load()), __esModule: true });
  const exports: { default?: sdk.CustomWidget } = {};
  const require = (specifier: string) => {
    const module = modules.get(specifier);
    if (!module) throw new Error(`Widgets cannot import ${specifier}.`);
    return module;
  };
  // Trusted saved widget code, like workflow programs; the app's CSP allows eval.
  new Function(
    "require",
    "exports",
    `${code}\n//# sourceURL=widget/${kind}.tsx`,
  )(require, exports);
  if (!exports.default?.Component)
    throw new Error("The widget file must default-export defineWidget(…).");
  return exports.default;
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="p-4 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function Failure({ error }: { error: unknown }) {
  return (
    <div role="alert" className="flex h-full flex-col gap-2 overflow-auto p-4">
      <p className="text-sm">This widget stopped with an error.</p>
      <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </pre>
    </div>
  );
}

function CustomWidgetContent({ kind }: { kind: string }) {
  const { transport, placementId } = useWidget();
  // Outside a Dashboard there is no symbol control to aim.
  const selection = React.useContext(ChartSelectionContext);
  const select = () => {
    if (readsSymbol(placementId)) selection?.focusWidget(placementId);
  };
  const code = useQuery(customWidgetCode(transport, kind));
  const revision = code.data?.revision;
  // Each revision evaluates once; its new Component identity remounts the widget.
  // The id keeps a kind deleted and saved again at revision 1 from reusing it.
  const widget = useQuery({
    queryKey: ["custom-widget-module", transport.url, code.data?.id, revision],
    queryFn: () => evaluateWidget(code.data!.code, kind),
    enabled: !!code.data,
    staleTime: Infinity,
    retry: false,
    meta: { silent: true },
  });
  if (code.data === null)
    return (
      <Status>
        No saved widget is named “{kind}”. Save its file again, or remove this
        placement.
      </Status>
    );
  // Query toasts load failures; a failed refetch keeps the last good revision.
  if (code.data === undefined)
    return code.error ? (
      <div className="p-4">
        <ResourceNotice
          error={code.error}
          onRetry={() => void code.refetch()}
        />
      </div>
    ) : (
      <Status>Loading widget…</Status>
    );
  if (widget.error) return <Failure error={widget.error} />;
  if (!widget.data) return <Status>Loading widget…</Status>;
  const { Component } = widget.data;
  return (
    <ErrorBoundary
      resetKeys={[revision]}
      fallbackRender={({ error }) => <Failure error={error} />}
    >
      {/* A widget that reads its symbol becomes the header symbol control's target, as a clicked chart does. */}
      <div
        className="relative h-full min-h-0 overflow-auto"
        onPointerDownCapture={select}
        onFocusCapture={select}
      >
        {code.error ? (
          // A failed refresh keeps this revision running; retry loads the newer one.
          <div className="absolute right-2 top-2 z-10 rounded-md bg-background">
            <ResourceNotice
              error={code.error}
              onRetry={() => void code.refetch()}
            />
          </div>
        ) : null}
        <Component />
      </div>
    </ErrorBoundary>
  );
}

const definitions = new Map<string, WidgetDefinition>();

/**
 * The stable definition for `custom:<kind>`, created once per kind so Dashboard
 * layout memoization and remounts follow placements, not renders. The card
 * title is the kind; the widget's code loads inside its content.
 * @example const definition = customWidgetDefinition("rates");
 */
export function customWidgetDefinition(kind: string): WidgetDefinition {
  let definition = definitions.get(kind);
  if (!definition) {
    definition = {
      kind: `${CUSTOM_WIDGET_PREFIX}${kind}`,
      title: kind,
      Icon: Blocks,
      defaultSize: { w: 6, h: 12 },
      minSize: { w: 3, h: 4 },
      Content: () => <CustomWidgetContent kind={kind} />,
    };
    definitions.set(kind, definition);
  }
  return definition;
}
