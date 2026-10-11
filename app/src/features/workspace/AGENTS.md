# Workspace files

- `workspace-view.tsx` composes the shared Sidebar (switcher and Add above, search
  below) and one Dockview group. Only widgets are `collapsible`.
- One Workspace shows at a time; `stores/view.ts` remembers it per placement and
  requested files select theirs. `file-tree.tsx` (Headless Tree) keeps 24px rows;
  badges fill the disclosure slot. Entries under dirty tabs never move.
- Dockview owns tabs/activation; identity is `{workspaceId, path}` in parameters and IDs,
  never view filters. `openWorkspaceFile` serves tree and language jumps.
- `file-actions.tsx` renders the active tab's actions from live Dockview params; editors
  register `save` in the view's `saves` by panel id. `.tea` tabs render lib's `WorkspaceFileActions`.
  Every panel starts with a path breadcrumb.
- The view owns one Tea reference dialog (`reference-manual.tsx`, data from `tea.reference`):
  `.tea` tabs' button opens it, ⌘ Click on a name opens its entry (`tea/referenceName`).
- WorkspaceContents publishes active-file `useAssistantContext` until unmount.
- Reads supply `readOnly`: built-ins cannot draft or save. Editable panels own drafts and
  original hashes; refresh preserves dirty text. Hash differences derive the conflict banner;
  AI admission must preserve the draft before clearing it. Saves use CAS; save and refresh failures stay distinct.
- `viewers.ts` maps MIME, then path, to one viewer: text edits; PDF/media/OOXML are
  read-only; other bytes open externally. Crepe setup isn't editing; non-Tea uses `inmemory:` URIs.
- Each view owns one lazy Tea session per workspace, disposed on unmount; library tabs are read-only.
- `UnsavedChangesProvider` shares route/window protection; removal reads live dirty/saving flags.
- Query/SSE owns metadata; disk owns files. Clean up Blob URLs. App owns routes and placement;
  widgets open, reveal, then clear their placement's file request, even one made before mount.
