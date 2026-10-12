# Custom widgets

Status: implemented 2026-10-11. Users ask the Agent for any dashboard widget;
the Agent writes a React component in a `.widget.tsx` Workspace file, saves it,
and places it. Widgets read OpenChart data through the same hooks and components
the built-in widgets use. The Agent's guide is
[docs/agent/widget.md](../agent/widget.md); dashboard placement follows
[widget architecture](widget-architecture.md).

## Trust model

Widget code is trusted, like [workflow programs](workflow.md): it runs in the
renderer's React tree with no sandbox, so it can use hooks and Context
directly. Its author is the user's own Agent or the user, whose
native file and shell access already exceeds the renderer's. The renderer is
sandboxed with context isolation and no Node, and its CSP limits connections to
the local backend, so widgets reach outside data only through the server.
A sandbox belongs at a future sharing boundary, if widgets ever come from
other people. Evaluation relies on the CSP's existing `'unsafe-eval'`; Vega needs
it too. A widget can still block the main thread; error boundaries cannot stop
an infinite loop.

## Lifecycle

```mermaid
sequenceDiagram
  participant A as Agent or user
  participant F as .widget.tsx file
  participant S as custom_widget.save
  participant R as custom_widget Resource
  participant D as Dashboard card
  A->>F: write and edit (nothing goes live)
  A->>S: save_widget(path) or the editor's Publish
  S->>F: read
  S->>S: strict type check against SDK declarations, read kind/title
  S-->>A: diagnostics on failure; nothing changes
  S->>R: new revision (or insert)
  A->>D: patch dashboard.widgets with custom:<kind>
  R-->>D: resource.changed refreshes compiled queries
  D->>R: compiled({kind}) → id, revision, CommonJS
  D->>D: evaluate, mount; a new revision remounts
```

| Stage   | Owner                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------- |
| Author  | Workspace file on disk; the Agent's native file tools or the Workspace editor                  |
| Check   | `server/widget/compile.ts` `checkWidget`, called by `save` only                                |
| Persist | `custom_widget` Resource: `kind` (unique), `title`, `source {workspaceId, path}`, `snapshot`   |
| Serve   | `compiled` query: `ts.transpileModule` per read, never stored                                  |
| Place   | Dashboard placement `{id, kind: "custom:<kind>", layout}`, one per kind per Dashboard          |
| Run     | `app/src/app/widgets/custom/custom-widget.tsx`: module table, `evaluateWidget`, error boundary |
| Symbol  | `useSymbol`: chosen with the Dashboard header's symbol control; localStorage per placement     |
| Data    | SDK hooks (Feed, Tea); each releases its own subscriptions on unmount                          |

Only `save` writes the Resource, so an unchecked or half-written file never
reaches a dashboard; `transitions/save.ts` owns the rule that refuses a kind
saved from another file. Deleting the widget leaves placements showing an
in-card notice; removing a placement keeps the widget; neither touches the file.

## Dependencies

Widgets import only the module table: `@openchart/widget`, `react`,
`react/jsx-runtime` and `vega-embed`. One list,
`app/tooling/widget-types.ts` `widgetImports`, generates:

- the declarations the server checks against (`widget.d.ts`, rolled up from
  `app/src/app/widgets/custom/sdk.ts` with React's own declarations and a small
  `vega-embed` shim), written beside the compiler by Vitest setup and emitted
  beside the Desktop backend bundle;
- `modules.json`, which the compiler reads for its import allowlist;
- Monaco's `virtual:widget-types`, for completion and diagnostics in the editor.

The renderer's `widgetModules` must list the same specifiers, and the Agent
guide must name every specifier and SDK export (a test checks both), so adding
a library is an app change to both lists. There is no npm install, CDN or
Workspace `node_modules` resolution.

The SDK is a public subset of what built-in widgets already use and does not
expose the transport. Saved files persist across app versions, so the SDK is a public
contract: a breaking change surfaces as diagnostics on the next save, or as an
in-card error when old code runs.

Data dependencies are references in code, not declared edges: a missing Tea
file or listing is an error the hook returns and the widget shows.

## Canonical controls

Choices the whole dashboard shares stay in the app's own controls, so custom
widgets feel native. The symbol is the first: widgets call `useSymbol()` and
never embed a picker. Targeting follows the page symbol entry rules in
[widget architecture](widget-architecture.md).

## Agent discovery

Nothing about the SDK is injected into prompts. The prompt's documentation line
points to `openchart/widget.md`, which Desktop ships in the version-matched
documentation directory with the example `price-chart.widget.tsx` beside it.

## Known limits

- Tailwind classes exist only when the app uses them; widgets style with inline
  styles, theme variables and SDK components.
- The Widgets menu lists the first page of saved widgets.
- Generating the declarations adds about 15 seconds to Vitest setup and builds.
- The source-run Agent demo does not write widget declarations, so saving a
  widget there fails until it does.
