# Composition

- Bootstrap supplies BackendConnection, AppHost and Clerk. `connection/` owns
  transport, reconnect and subscription cleanup; Layout keys consumers by attempt.
  AccountConnectionProvider wraps the workspace, which opens signed in or out.
  AppHostProvider supplies native operations. Route changes detach observations
  without cancelling execution; the last subscriber closes SSE.
- Layout retains LeftSidebar, SidebarInset/Outlet and CopilotAgent. It owns
  Copilot selection/visibility; CopilotControlsProvider shares controls. Full-page
  Agent routes hide Copilot. Preserve mobile navigation and sidebar resizing.
- Layout's assistant-ui modelContext joins page contributors and Copilot.
  Contributors retain their state; Copilot captures context before submission.
  Conversation runtimes remain isolated.
- `left-sidebar/` composes navigation, queried Dashboards/Alerts, Chats, the
  Cloud SubscribeBanner (which rechecks providers on billing change) and the
  AccountButton row: GitHub/Discord (`community-urls.ts`), or the restart
  button once an update downloads.
  Section headings reuse creation actions and select timestamp sorting before
  pagination; `stores/sidebar.ts` persists only each section's display preference.
  Layout owns rename dialogs; FullPageAgent selects Sessions before submitting.
  UnsavedChangesProvider spans the sidebar and routed pages.
  `route-context.ts` shares transport; `useAgentContext` shares Agent only.
- Follow [agent](agent/AGENTS.md), [dashboard](dashboard/AGENTS.md),
  [trellis](trellis/AGENTS.md) and [widgets](widgets/AGENTS.md) ownership. Dashboard receives the registry and owns writes.
  `page-header` composes sidebar/Copilot controls; `section-page` owns section frames.
- RouterProvider uses `useTransitions={false}` so navigation commits observations
  before waiting for live state. Query owns directory caches.
- AppProvider owns Query/error providers and one Sonner toaster. Query reports
  request failures; non-Query observations use `useErrorToast`. Preserve drafts,
  recovery controls, validation and execution history; never duplicate operational
  messages inline. Layout applies Config theme. Follow app/DESIGN.md.
