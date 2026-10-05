// Purpose: Discover studies through visual examples and natural-language prompts, with chart-owned attachment actions.
import { useContext, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, Compass, FileCode2, Library, Plus } from "lucide-react";
import type * as Tea from "@openchart/tea";
import { Button } from "@openchart/app/components/ui/button";
import "./indicator-library.css";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openchart/app/components/ui/tabs";
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@openchart/app/components/ui/sidebar";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  WorkspaceFileNavigation,
  defaultWorkspaceQueryOptions,
  workspacesQueryOptions,
  workspaceTreeQueryOptions,
} from "@openchart/app/lib/workspace/workspace";
import {
  indicatorCatalogQueryOptions,
  resolveIndicator,
  type IndicatorCatalogEntry,
  type IndicatorSelection,
} from "@openchart/app/features/chart/api/indicator-scripts";
import {
  assignIndicatorExamples,
  indicatorExampleForKey,
  indicatorExampleQueryOptions,
  indicatorStudyWindows,
  type IndicatorExampleId,
} from "@openchart/app/features/chart/api/indicator-examples";
import { IndicatorPreview } from "./indicator-preview";
import { useAddIndicator } from "./add-to-chart";
import { IndicatorLibraryDetail } from "./indicator-library-detail";

const goals = [
  {
    key: "follow-trends",
    label: "Follow trends",
    featured: "supertrend-regime",
  },
  {
    key: "find-breakouts",
    label: "Find breakouts",
    featured: "bollinger-squeeze",
  },
  {
    key: "find-reversals",
    label: "Find reversals",
    featured: "rsi-divergence",
  },
  { key: "read-volume", label: "Read volume", featured: "anchored-vwap-bands" },
  {
    key: "understand-volatility",
    label: "Understand volatility",
    featured: "atr-percentile",
  },
  {
    key: "read-structure",
    label: "Read structure",
    featured: "confirmed-swing-map",
  },
] as const;
const scopes = [
  { name: "Discover", icon: Compass },
  { name: "All indicators", icon: Library },
  { name: "My scripts", icon: FileCode2 },
] as const;
type Scope = (typeof scopes)[number]["name"];
type Study = { source: Tea.WorkspaceSources; entry?: IndicatorCatalogEntry };

/** Browse studies on shared cached history; previews never acquire market data and Add preserves the captured chart cell. The app owns Agent admission. @example <IndicatorLibraryContent transport={transport} chartId={chartId} cellId={cellId} composer={composer} query={query} onClose={close} onUsePrompt={prefill} onModifyScript={modify} /> */
export function IndicatorLibraryContent({
  transport,
  chartId,
  cellId,
  onClose,
  composer,
  query,
  onUsePrompt,
  onModifyScript,
}: {
  transport: AppTransport;
  chartId: string;
  cellId: string;
  onClose: () => void;
  composer: ReactNode;
  query: string;
  onUsePrompt: (prompt: string, source?: Tea.WorkspaceSources) => void;
  onModifyScript: (source: Tea.WorkspaceSources) => void;
}) {
  const [scope, setScope] = useState<Scope>("Discover");
  const [goal, setGoal] = useState<(typeof goals)[number]>(goals[0]);
  const [study, setStudy] = useState<Study>();
  const readFiles = scope === "My scripts" || query.trim().length > 0;
  const navigate = useContext(WorkspaceFileNavigation);
  if (!navigate)
    throw new Error("The study library requires Workspace file navigation.");
  const catalog = useQuery(indicatorCatalogQueryOptions(transport));
  const examples = useMemo(
    () => assignIndicatorExamples((catalog.data ?? []).map(({ id }) => id)),
    [catalog.data],
  );
  const workspaces = useQuery({
    ...workspacesQueryOptions(transport),
    enabled: readFiles,
  });
  const home = useQuery(defaultWorkspaceQueryOptions(transport));
  const trees = useQueries({
    queries: (workspaces.data ?? []).map((workspace) => ({
      ...workspaceTreeQueryOptions(transport, workspace.id),
      enabled: readFiles,
    })),
  });
  const adder = useAddIndicator({
    transport,
    chartId,
    cellId,
    onAdded: onClose,
  });
  const opener = useMutation({
    retry: false,
    meta: { errorTitle: "Couldn’t open this study" },
    mutationFn: async (choice: {
      selection: IndicatorSelection;
      entry?: IndicatorCatalogEntry;
    }) => ({
      source: await resolveIndicator(transport, choice.selection),
      entry: choice.entry,
    }),
    onSuccess: setStudy,
  });
  const busy = adder.pending || opener.isPending;
  const needle = query.trim().toLocaleLowerCase();
  const entries = (catalog.data ?? []).filter((entry) =>
    needle
      ? `${entry.name} ${entry.discovery?.headline ?? ""} ${entry.description} ${entry.prompt} ${entry.goals.map((key) => goals.find((item) => item.key === key)?.label ?? key).join(" ")}`
          .toLocaleLowerCase()
          .includes(needle)
      : scope !== "Discover" ||
        (entry.discovery && entry.goals.some((key) => key === goal.key)),
  );
  if (scope === "Discover" && !needle)
    entries.sort((a, b) => a.discovery!.rank - b.discovery!.rank);
  const featured =
    scope === "Discover" && !needle
      ? (entries.find(({ id }) => id === goal.featured) ?? entries[0])
      : undefined;
  const files = (
    home.data && catalog.data ? (workspaces.data ?? []) : []
  ).flatMap((workspace, index) => {
    const tree = trees[index]?.data;
    return tree?.status === "ready"
      ? tree.entries
          .filter(
            ({ path }) =>
              path.endsWith(".tea") &&
              !(
                workspace.id === home.data &&
                catalog.data?.some(
                  (entry) =>
                    path.toLocaleLowerCase() === entry.path.toLocaleLowerCase(),
                )
              ),
          )
          .map(({ path }) => ({
            workspaceId: workspace.id,
            path,
            root: workspace.root,
          }))
      : [];
  });
  const custom = files.filter((file) =>
    `${file.path} ${file.root}`.toLocaleLowerCase().includes(needle),
  );
  const personal = scope === "My scripts";
  const loading =
    catalog.isPending ||
    (readFiles &&
      (workspaces.isPending ||
        home.isPending ||
        trees.some((tree) => tree.isPending)));
  const unavailable =
    readFiles &&
    trees.some((tree) => tree.data && tree.data.status !== "ready");
  const failed =
    catalog.isError ||
    (readFiles &&
      (workspaces.isError ||
        home.isError ||
        trees.some((tree) => tree.isError) ||
        unavailable));
  const retry = () => {
    void catalog.refetch();
    if (readFiles) {
      void workspaces.refetch();
      void home.refetch();
      trees.forEach((tree) => {
        void tree.refetch();
      });
    }
  };
  const prefillPrompt = (prompt: string, source?: Tea.WorkspaceSources) => {
    setStudy(undefined);
    setScope("Discover");
    onUsePrompt(prompt, source);
  };
  const select = (entry: IndicatorCatalogEntry) =>
    opener.mutate({ selection: entry.id, entry });
  const openSource = ({ workspaceId, path }: Tea.WorkspaceSources) => {
    onClose();
    navigate({ workspaceId, path });
  };
  const preview = (
    key: string,
    source: Tea.WorkspaceSources | undefined,
    parameters: Tea.ParameterOverrides = {},
    interactive = false,
    onResolved?: (parameters: Tea.ParameterOverrides | undefined) => void,
  ) =>
    source ? (
      <StudyPreview
        source={source}
        exampleId={examples.get(key) ?? indicatorExampleForKey(key)}
        endTime={indicatorStudyWindows[key]?.endTime}
        parameters={parameters}
        interactive={interactive}
        onResolved={onResolved}
      />
    ) : (
      <div
        role="status"
        className="flex h-full min-h-36 items-center justify-center p-4 text-sm text-muted-foreground"
      >
        {home.isError ? "Preview unavailable" : "Loading chart…"}
      </div>
    );
  const cardPreview = (entry: IndicatorCatalogEntry) =>
    preview(
      entry.id,
      home.data ? { workspaceId: home.data, path: entry.path } : undefined,
    );
  return (
    <SidebarProvider
      embedded
      className="indicator-library-frame h-full min-h-0 items-stretch"
    >
      <Sidebar
        collapsible="none"
        className="indicator-library-sidebar w-40 border-r"
      >
        <SidebarContent className="px-2 py-4">
          <SidebarMenu>
            {scopes.map(({ name, icon: Icon }) => (
              <SidebarMenuItem key={name}>
                <SidebarMenuButton
                  disabled={busy}
                  isActive={scope === name}
                  onClick={() => {
                    setScope(name);
                    setStudy(undefined);
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <div className="indicator-library-content flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className="indicator-library-compact-nav flex shrink-0 gap-1 border-b px-4 py-2 pr-12"
          aria-label="Library navigation"
        >
          <select
            aria-label="Library section"
            value={scope}
            disabled={busy}
            className="rounded-md border bg-background px-2 py-1 text-sm"
            onChange={(event) => {
              const chosen = scopes.find(
                ({ name }) => name === event.target.value,
              );
              if (chosen) {
                setScope(chosen.name);
                setStudy(undefined);
              }
            }}
          >
            {scopes.map(({ name }) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        {study ? (
          <IndicatorLibraryDetail
            key={`${study.source.workspaceId}:${study.source.path}`}
            {...study}
            scope={scope}
            busy={busy}
            onBack={() => setStudy(undefined)}
            onAdd={(values) =>
              adder.add(() => Promise.resolve(study.source), values)
            }
            onOpenSource={() => openSource(study.source)}
            preview={(parameters, onResolved) =>
              preview(
                study.entry?.id ??
                  JSON.stringify([study.source.workspaceId, study.source.path]),
                study.source,
                parameters,
                true,
                onResolved,
              )
            }
            onModify={() => {
              setStudy(undefined);
              setScope("Discover");
              onModifyScript(study.source);
            }}
          />
        ) : (
          <Tabs
            value={goal.key}
            onValueChange={(key) => {
              const chosen = goals.find((item) => item.key === key);
              if (chosen) setGoal(chosen);
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <header className="shrink-0 space-y-3 px-4 pb-3 pr-12 pt-4 lg:px-5 lg:pr-12">
              <h1 className="font-studio text-lg font-medium">
                {personal
                  ? "My scripts"
                  : scope === "All indicators"
                    ? "All indicators"
                    : "What are you looking for?"}
              </h1>
              {composer}
              {!personal && scope === "Discover" && !needle ? (
                <div className="overflow-x-auto overflow-y-hidden pb-2">
                  <TabsList
                    variant="line"
                    className="justify-start gap-4 p-0"
                    aria-label="Study purpose"
                  >
                    {goals.map((item) => (
                      <TabsTrigger
                        key={item.key}
                        value={item.key}
                        disabled={busy}
                        className="flex-none px-0 pb-2 text-sm"
                      >
                        {item.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              ) : null}
            </header>
            <TabsContent
              key={`${scope}:${goal.key}`}
              value={goal.key}
              data-library-scroll=""
              className="mt-0 min-h-0 flex-1 overflow-y-auto"
            >
              <main
                className="space-y-5 px-4 pb-5 lg:px-5"
                aria-busy={loading || opener.isPending}
              >
                {loading ? (
                  <p
                    role="status"
                    className="py-12 text-sm text-muted-foreground"
                  >
                    Loading studies…
                  </p>
                ) : null}
                {failed ? (
                  <div className="space-y-3 rounded-lg border p-6">
                    <p className="text-sm">
                      {unavailable
                        ? "Some Workspaces are unavailable. Available scripts are shown below."
                        : "Couldn’t load these studies."}
                    </p>
                    <Button size="sm" variant="outline" onClick={retry}>
                      Retry
                    </Button>
                  </div>
                ) : null}
                {opener.isPending ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Opening study…
                  </p>
                ) : null}
                {!loading && personal ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-muted-foreground">
                        Your studies, from all registered Workspaces.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          prefillPrompt("Create an indicator that ")
                        }
                      >
                        <Plus className="size-4" /> Create a study
                      </Button>
                    </div>
                    {custom.length ? (
                      <ScriptRows
                        files={custom}
                        busy={busy}
                        onSelect={openSource}
                      />
                    ) : !failed ? (
                      <EmptyLibrary query={needle} personal />
                    ) : null}
                  </>
                ) : !loading ? (
                  <>
                    {featured ? (
                      <StudyCard
                        entry={featured}
                        preview={() => cardPreview(featured)}
                        featured
                        busy={busy}
                        onSelect={() => select(featured)}
                      />
                    ) : null}
                    {entries.length ? (
                      <section className="space-y-3">
                        <h2 className="text-sm font-medium">
                          {needle
                            ? `${entries.length} matching ${entries.length === 1 ? "study" : "studies"}`
                            : featured
                              ? "More indicators to explore"
                              : `${entries.length} indicators`}
                        </h2>
                        <div className="indicator-library-gallery grid gap-x-4 gap-y-5">
                          {entries
                            .filter((entry) => entry !== featured)
                            .map((entry) => (
                              <StudyCard
                                key={entry.id}
                                entry={entry}
                                preview={() => cardPreview(entry)}
                                busy={busy}
                                onSelect={() => select(entry)}
                              />
                            ))}
                        </div>
                      </section>
                    ) : (!needle || !custom.length) && !failed ? (
                      <EmptyLibrary query={needle} />
                    ) : null}
                    {needle && custom.length ? (
                      <section className="space-y-3">
                        <h2 className="text-sm font-medium">Your studies</h2>
                        <ScriptRows
                          files={custom}
                          busy={busy}
                          onSelect={openSource}
                        />
                      </section>
                    ) : null}
                  </>
                ) : null}
              </main>
            </TabsContent>
          </Tabs>
        )}
      </div>
      {adder.flow}
    </SidebarProvider>
  );
}

function StudyPreview({
  source,
  exampleId,
  endTime,
  parameters,
  interactive,
  onResolved,
}: {
  source: Tea.WorkspaceSources;
  exampleId: IndicatorExampleId;
  endTime?: number;
  parameters: Tea.ParameterOverrides;
  interactive: boolean;
  onResolved?: (parameters: Tea.ParameterOverrides | undefined) => void;
}) {
  const example = useQuery(indicatorExampleQueryOptions(exampleId));
  if (example.data)
    return (
      <IndicatorPreview
        source={source}
        example={example.data}
        endTime={endTime}
        parameters={parameters}
        interactive={interactive}
        onResolved={onResolved}
        className={
          interactive
            ? "aspect-[3/1] min-h-60 rounded-lg border"
            : "pointer-events-none h-full w-full"
        }
      />
    );
  return (
    <div
      role="status"
      className="flex h-full min-h-36 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground"
    >
      <span>{example.isError ? "Preview unavailable" : "Loading chart…"}</span>
      {interactive && example.isError ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void example.refetch()}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}

function ScriptRows({
  files,
  busy,
  onSelect,
}: {
  files: readonly (Tea.WorkspaceSources & { root: string })[];
  busy: boolean;
  onSelect: (file: Tea.WorkspaceSources) => void;
}) {
  return (
    <div className="divide-y rounded-lg border">
      {files.map((file) => (
        <button
          key={`${file.workspaceId}:${file.path}`}
          type="button"
          aria-label={`${file.path.split("/").at(-1)} · ${file.root.split("/").at(-1)} / ${file.path}`}
          title={`${file.root}/${file.path}`}
          disabled={busy}
          onClick={() => onSelect(file)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <FileCode2 className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {file.path.split("/").at(-1)}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {file.root.split("/").at(-1)} / {file.path}
            </span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

function StudyCard({
  entry,
  preview,
  featured = false,
  busy,
  onSelect,
}: {
  entry: IndicatorCatalogEntry;
  preview: () => ReactNode;
  featured?: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={entry.name}
      disabled={busy}
      onClick={onSelect}
      className={`group overflow-hidden text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${featured ? "indicator-library-featured grid w-full items-center rounded-lg border hover:bg-muted/20" : "flex w-full flex-col gap-2 rounded-md hover:bg-muted/20"}`}
    >
      <div
        className={`indicator-library-card-preview aspect-[2/1] min-h-36 w-full overflow-hidden ${featured ? "border-b" : "rounded-md border"}`}
      >
        {preview()}
      </div>
      <div
        className={
          featured ? "flex flex-col justify-center gap-3 p-4" : "space-y-1 pb-1"
        }
      >
        <div className="space-y-1">
          {featured && entry.discovery ? (
            <h3 className="font-studio text-lg font-medium">
              {entry.discovery.headline}
            </h3>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {featured && entry.discovery ? (
              <span className="text-sm text-muted-foreground">
                {entry.name}
              </span>
            ) : (
              <h3
                className={
                  featured
                    ? "font-studio text-lg font-medium"
                    : "text-sm font-medium"
                }
              >
                {entry.name}
              </h3>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {entry.category}
            </span>
          </div>
        </div>
        <p
          className={`${featured ? "line-clamp-3 text-sm" : "line-clamp-2 text-xs"} leading-relaxed text-muted-foreground`}
        >
          {entry.prompt}
        </p>
        {featured ? (
          <span className="mt-1 flex items-center gap-2 text-sm font-medium">
            View study <ArrowRight className="size-4" />
          </span>
        ) : null}
      </div>
    </button>
  );
}

function EmptyLibrary({
  query,
  personal = false,
}: {
  query: string;
  personal?: boolean;
}) {
  return (
    <div className="space-y-2 py-12 text-center">
      <h2 className="text-sm font-medium">
        {query
          ? "No studies match this search"
          : personal
            ? "Your studies will appear here"
            : "No studies available"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {query
          ? "Try another name, or send your description to create a study."
          : personal
            ? "Create a study with a prompt, or save a script in your Workspace."
            : "Retry loading the library."}
      </p>
    </div>
  );
}
