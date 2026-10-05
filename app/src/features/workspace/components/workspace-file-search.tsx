// Purpose: Search workspace paths through cmdk without changing the mounted folder tree.
import { useRef, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { File, Search, X } from "lucide-react";
import { defaultFilter } from "cmdk";
import { Button } from "@openchart/app/components/ui/button";
import { SidebarGroupLabel } from "@openchart/app/components/ui/sidebar";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@openchart/app/components/ui/command";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { workspaceTreeQueryOptions } from "@openchart/app/lib/workspace/workspace";
import { cn } from "@openchart/app/utils/cn";

type Workspace = { id: string; root: string };

/** Inline file search; cmdk owns matching and selection, Query owns path snapshots.
 * Clearing the query reveals the still-mounted tree and its original expansion state.
 * @example <WorkspaceFileSearch transport={transport} workspaces={workspaces} onOpen={openFile}>{tree}</WorkspaceFileSearch>
 */
export function WorkspaceFileSearch({
  transport,
  workspaces,
  onOpen,
  disabled = false,
  title,
  navigation,
  actions,
  children,
}: {
  transport: AppTransport;
  workspaces: readonly Workspace[];
  onOpen: (workspaceId: string, path: string) => void;
  disabled?: boolean;
  title?: string;
  navigation?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const field = useRef<HTMLDivElement>(null);
  const searching = search.trim().length > 0;
  const focusInput = () => field.current?.querySelector("input")?.focus();
  return (
    <>
      <div className="relative">
        <Command
          label="Search files"
          className="h-auto overflow-visible rounded-none bg-transparent"
          // Keep opaque workspace IDs out of matching; cmdk still owns scoring.
          filter={(_value, query, keywords) =>
            defaultFilter("", query, keywords)
          }
        >
          <div
            className={cn(
              "flex items-center gap-1 pr-8",
              title ? "h-11" : "h-8",
            )}
          >
            {navigation}
            {title ? (
              <SidebarGroupLabel className="min-w-0 flex-1 overflow-hidden">
                <h1 className="truncate font-studio text-base font-medium text-foreground">
                  {title}
                </h1>
              </SidebarGroupLabel>
            ) : null}
            <div
              ref={field}
              className="workspace-file-search-field relative ml-auto w-7 min-w-0 max-w-full rounded-md bg-background"
              data-query={search.length > 0}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute left-0 top-0 size-7"
                aria-label="Find file"
                disabled={disabled}
                onClick={focusInput}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Search />
              </Button>
              <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search files…"
                autoComplete="off"
                disabled={disabled}
                spellCheck={false}
                className="h-7 py-0 pl-7 pr-7 text-sm"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (search) setSearch("");
                  else event.currentTarget.blur();
                }}
              />
              {search ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-0 top-0 size-7"
                  aria-label="Clear file search"
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    setSearch("");
                    focusInput();
                  }}
                >
                  <X />
                </Button>
              ) : null}
            </div>
          </div>
          <CommandList hidden={!searching} className="max-h-none">
            {searching ? (
              <FileSearchResults
                transport={transport}
                workspaces={workspaces}
                onOpen={onOpen}
              />
            ) : null}
          </CommandList>
        </Command>
        <div className={cn("absolute right-1", title ? "top-3" : "top-1.5")}>
          {actions}
        </div>
      </div>
      <div hidden={searching}>{children}</div>
    </>
  );
}

function FileSearchResults({
  transport,
  workspaces,
  onOpen,
}: {
  transport: AppTransport;
  workspaces: readonly Workspace[];
  onOpen: (workspaceId: string, path: string) => void;
}) {
  // Mounted only while searching: read unopened folders once per search session.
  const queries = useQueries({
    queries: workspaces.map((workspace) =>
      workspaceTreeQueryOptions(transport, workspace.id),
    ),
  });
  const loading = queries.some((query) => query.isPending);
  const failed = queries.some(
    (query) => query.isError || (query.data && query.data.status !== "ready"),
  );
  return (
    <>
      {loading ? (
        <p role="status" className="p-2 text-sm text-muted-foreground">
          Searching files…
        </p>
      ) : null}
      {!loading && !failed ? (
        <CommandEmpty>No matching files.</CommandEmpty>
      ) : null}
      {queries.map((query, index) => {
        const workspace = workspaces[index]!;
        const name = workspace.root.split(/[\\/]/).filter(Boolean).at(-1);
        if (query.isPending) return null;
        if (query.isError || query.data?.status !== "ready")
          return (
            <div key={workspace.id} className="p-2 text-sm">
              <p className="text-muted-foreground">Couldn’t search {name}.</p>
              <Button
                size="sm"
                variant="ghost"
                onKeyDown={(event) => event.stopPropagation()}
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            </div>
          );
        return query.data.entries.map(({ path }) => (
          <CommandItem
            key={`${workspace.id}/${path}`}
            value={`${workspace.id}/${path}`}
            keywords={[name ?? workspace.root, path]}
            onSelect={() => onOpen(workspace.id, path)}
            title={`${workspace.root}/${path}`}
            className="min-w-0 gap-2 px-2 py-1"
          >
            <File className="text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate">{path.split("/").at(-1)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[name, ...path.split("/").slice(0, -1)].join("/")}
              </span>
            </span>
          </CommandItem>
        ));
      })}
    </>
  );
}
