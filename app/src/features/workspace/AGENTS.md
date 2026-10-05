# Workspace files

- `workspace-view.tsx` composes the shared Sidebar and one Dockview group; preserve
  its menu structure, tokens and container sizing. Tree rows are 24px, gapless,
  left-nested; files reserve the disclosure slot. Only widgets are `collapsible`.
- `workspace-tree.tsx` lists registered folders through Query; widgets and the page
  show all of them without selection state. Creation explicitly targets workspace/folder.
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
- Markdown uses lazy Crepe with Monaco source fallback; initialization is not editing.
  Non-Tea buffers use `inmemory:` model URIs; Workspace owns their disk reads/saves.
- Each view owns one lazy Tea session per workspace, disposed on unmount; library tabs are read-only.
- `UnsavedChangesProvider` shares route/window protection; removal reads live dirty/saving flags.
- Query/SSE owns metadata; disk owns files. Clean up Blob URLs. App owns routes and placement;
  widgets open, reveal, then clear their placement's file request, even one made before mount.
