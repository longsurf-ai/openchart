// Purpose: Browse Tea's reference manual in a dialog: pages in a rail, a searchable entry list, and entry pages.
// Layout: the indicator picker's frame, from shadcn/ui a87a63b2ca25143d26c8bd0903e4e9bc77b3f824 blocks/sidebar-13 (MIT, ../../../components/ui/LICENSE.shadcn), with the app sidebar's floating rail; sections use Jan's settings cards.
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { useShikiHighlighter } from "react-shiki";
import teaGrammar from "@openchart/tea-editor/syntaxes/tea.tmLanguage.json?raw";
import { Badge } from "@openchart/app/components/ui/badge";
import { Button } from "@openchart/app/components/ui/button";
import { CodeBlock } from "@openchart/app/components/ui/code-block/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@openchart/app/components/ui/empty/empty";
import { Input } from "@openchart/app/components/ui/input";
import { Markdown } from "@openchart/app/components/ui/markdown/markdown";
import { Card, CardItem } from "@openchart/app/components/ui/settings/card";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@openchart/app/components/ui/sidebar";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { useWorkspaceView } from "./context";

type Manual = Awaited<
  ReturnType<AppTransport["rpc"]["tea"]["reference"]["query"]>
>;
type Page = Manual["groups"][number]["pages"][number];
type Entry = Extract<Page, { kind: "entries" }>["entries"][number];

// The editor's own grammar, so the manual reads Tea as the editor does; the
// themes are the ones Agent code blocks use.
const tea = { ...JSON.parse(teaGrammar), name: "tea" };
const themes = { light: "github-light-default", dark: "github-dark-default" };

/**
 * Tea's reference manual: the script-facing Reference pages the server's Tea
 * version ships, in the Reference's groups. It opens at the entry documenting
 * `name`, such as `ta.sma` or `color.red`, when given. Search covers every
 * entry, then the pages whose title or text mentions it; a `#` link inside
 * the manual opens the entry or page it names. The dialog owns only what is
 * open.
 * @example <ReferenceManual name="ta.sma" onClose={() => setOpen(false)} />
 */
export function ReferenceManual({
  name,
  onClose,
}: {
  name?: string;
  onClose: () => void;
}) {
  const { transport } = useWorkspaceView();
  const manual = useQuery({
    queryKey: ["tea", "reference", transport.url],
    queryFn: () => transport.rpc.tea.reference.query(),
    staleTime: Infinity,
  });
  const [pageId, setPageId] = useState<string>();
  // An entry's id or any name it documents, such as `color.red` of `color.*`.
  const [entryName, setEntryName] = useState(name);
  const [search, setSearch] = useState("");
  const content = useRef<HTMLDivElement>(null);
  const pages = manual.data?.groups.flatMap((group) => group.pages) ?? [];
  const entries = pages.flatMap((candidate) =>
    candidate.kind === "entries"
      ? candidate.entries.map((entry) => ({ entry, page: candidate }))
      : [],
  );
  const opened =
    entryName === undefined
      ? undefined
      : entries.find(
          ({ entry }) =>
            entry.id === entryName || entry.symbols.includes(entryName),
        );
  const entry = opened?.entry;
  const page =
    opened?.page ??
    pages.find((candidate) => candidate.id === pageId) ??
    pages[0];
  const needle = search.trim().toLocaleLowerCase();
  const found = needle
    ? entries.filter(({ entry }) =>
        `${entry.id} ${entry.summary}`.toLocaleLowerCase().includes(needle),
      )
    : [];
  // Pages whose title or text mentions the search, such as the Language page
  // that documents `switch`, follow the entries.
  const foundPages = needle
    ? pages.filter((candidate) =>
        `${candidate.title} ${candidate.kind === "article" ? candidate.markdown : candidate.intro}`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : [];

  const open = (target: { page: string; entry?: string }) => {
    setPageId(target.page);
    setEntryName(target.entry);
    setSearch("");
    if (content.current) content.current.scrollTop = 0;
  };
  // `#ta.sma` names an entry and `#reference/builtins/ta` a page.
  const followLink = (event: MouseEvent) => {
    const href = (event.target as HTMLElement)
      .closest("a")
      ?.getAttribute("href");
    if (!href?.startsWith("#")) return;
    event.preventDefault();
    const id = href.slice(1);
    const linked = entries.find(({ entry }) => entry.id === id);
    if (linked) open({ page: linked.page.id, entry: id });
    else if (pages.some((candidate) => candidate.id === id)) open({ page: id });
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="overflow-hidden p-0 md:max-h-[min(760px,88dvh)] md:max-w-[1120px]">
        <DialogTitle className="sr-only">Tea reference</DialogTitle>
        <DialogDescription className="sr-only">
          Look up Tea syntax, built-ins and libraries.
        </DialogDescription>
        <SidebarProvider embedded className="min-h-0 items-start">
          <Sidebar variant="floating">
            <SidebarContent>
              {manual.data?.groups.map((group) => (
                <SidebarGroup key={group.title}>
                  <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.pages.map((candidate) => (
                        <SidebarMenuItem key={candidate.id}>
                          <SidebarMenuButton
                            isActive={!needle && candidate.id === page?.id}
                            onClick={() => open({ page: candidate.id })}
                          >
                            <span>{candidate.title}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>
          </Sidebar>
          <div className="flex h-[720px] max-h-[calc(88dvh-2px)] min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex min-h-16 shrink-0 items-center gap-2 px-4 py-3 pr-12">
              {entry && !needle ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => open({ page: page!.id })}
                >
                  <ArrowLeft className="size-4" /> {page!.title}
                </Button>
              ) : (
                <span className="font-medium">
                  {needle ? "Search" : (page?.title ?? "Tea reference")}
                </span>
              )}
            </header>
            <div className="border-b px-4 pb-3">
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
                />
                <Input
                  aria-label="Search the reference"
                  placeholder="Search functions, variables, types…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Delegates clicks from the links inside; each is a native link that Enter activates. */}
            <div
              ref={content}
              onClick={followLink}
              className="min-h-0 flex-1 overflow-y-auto p-4"
            >
              {manual.isPending ? (
                <p
                  role="status"
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  Loading the reference…
                </p>
              ) : manual.isError ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>Couldn’t load the reference</EmptyTitle>
                    <EmptyDescription>{manual.error.message}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void manual.refetch()}
                    >
                      Retry
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : needle ? (
                found.length + foundPages.length > 0 ? (
                  <>
                    <EntryList
                      rows={found}
                      onOpen={(row) =>
                        open({ page: row.page.id, entry: row.entry.id })
                      }
                    />
                    <PageList
                      pages={foundPages}
                      onOpen={(target) => open({ page: target.id })}
                    />
                  </>
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Search />
                      </EmptyMedia>
                      <EmptyTitle>No matching entries</EmptyTitle>
                      <EmptyDescription>
                        Try another name or clear your search.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )
              ) : entry ? (
                <EntryPage entry={entry} />
              ) : page?.kind === "article" ? (
                <Prose text={page.markdown} />
              ) : page ? (
                <div className="flex flex-col gap-4">
                  <Prose text={page.intro} />
                  <EntryList
                    rows={page.entries.map((candidate) => ({
                      entry: candidate,
                      page,
                    }))}
                    onOpen={(row) =>
                      open({ page: page.id, entry: row.entry.id })
                    }
                  />
                </div>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <BookOpen />
                    </EmptyMedia>
                    <EmptyTitle>The reference is empty</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </div>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}

type Row = {
  entry: Entry;
  page: Extract<Page, { kind: "entries" }>;
};

// Row composition follows the indicator picker: a full-width ghost button per entry.
function EntryList({
  rows,
  onOpen,
}: {
  rows: readonly Row[];
  onOpen: (row: Row) => void;
}) {
  return (
    <ul aria-label="Entries" className="flex flex-col">
      {rows.map((row) => (
        <li key={row.entry.id}>
          <Button
            variant="ghost"
            className="h-auto min-h-10 w-full justify-start px-2 py-2 text-left font-normal"
            onClick={() => onOpen(row)}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-mono text-[13px]">
                {displayName(row.entry)}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {plain(row.entry.summary)}
              </span>
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {row.entry.category}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

// Pages found by search, in the entry rows' style.
function PageList({
  pages,
  onOpen,
}: {
  pages: readonly Page[];
  onOpen: (page: Page) => void;
}) {
  if (pages.length === 0) return null;
  return (
    <ul aria-label="Pages" className="flex flex-col">
      {pages.map((page) => (
        <li key={page.id}>
          <Button
            variant="ghost"
            className="h-auto min-h-10 w-full justify-start px-2 py-2 text-left font-normal"
            onClick={() => onOpen(page)}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-[13px]">{page.title}</span>
              <span className="truncate text-xs text-muted-foreground">
                {plain(page.description)}
              </span>
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              Page
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function EntryPage({ entry }: { entry: Entry }) {
  const overloads = entry.signatures.length;
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-lg font-medium text-foreground">
            {displayName(entry)}
          </h2>
          {overloads > 1 ? (
            <Badge variant="secondary">{overloads} overloads</Badge>
          ) : null}
        </div>
        <Prose text={entry.summary} />
      </header>
      {overloads > 0 ? (
        <Card title={overloads > 1 ? "Syntax & overloads" : "Syntax"}>
          {entry.signatures.map((signature) => (
            <TeaCode key={signature} code={signature} />
          ))}
        </Card>
      ) : null}
      {entry.parameters.length > 0 ? (
        <Card title="Parameters">
          {entry.parameters.map((parameter) => (
            <CardItem
              key={parameter.name}
              column
              title={
                <span className="font-mono text-[13px]">
                  {parameter.name}
                  {parameter.type ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({parameter.type})
                    </span>
                  ) : null}
                  {parameter.defaultValue ? (
                    <span className="text-muted-foreground">
                      {" "}
                      = {parameter.defaultValue}
                    </span>
                  ) : null}
                </span>
              }
              description={<Prose text={parameter.description} />}
            />
          ))}
        </Card>
      ) : null}
      {entry.returns ? (
        <Card title="Returns">
          <Prose text={entry.returns} />
        </Card>
      ) : null}
      {entry.members ? (
        <Card title={entry.kind === "constant" ? "Constants" : "Members"}>
          <Markdown text={markdownTable(entry.members)} />
        </Card>
      ) : null}
      {entry.body ? <Prose text={entry.body} /> : null}
    </article>
  );
}

// Prose whose fenced code renders in the app's code panel, Tea highlighted,
// and whose `$$` blocks render as formulas.
function Prose({ text }: { text: string }) {
  const parts = text.split(/```(\w*)\n([\s\S]*?)```/g);
  return (
    <>
      {parts.map((part, index) => {
        // split() yields text, then each fence's language and code.
        if (index % 3 === 1) return null;
        if (index % 3 === 2)
          return (
            <Code
              key={index}
              code={part.trimEnd()}
              language={parts[index - 1] ?? ""}
            />
          );
        return part.trim() ? <Markdown key={index} text={part} math /> : null;
      })}
    </>
  );
}

function Code({ code, language }: { code: string; language: string }) {
  return language === "tea" ? (
    <TeaCode code={code} />
  ) : (
    <CodeBlock className="my-2">
      <pre>
        <code>{code}</code>
      </pre>
    </CodeBlock>
  );
}

function TeaCode({ code }: { code: string }) {
  const highlighted = useShikiHighlighter(code, tea, themes, {
    defaultColor: "light-dark()",
  });
  return (
    <CodeBlock className="my-2">
      {highlighted ?? (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </CodeBlock>
  );
}

// `ta.sma()` for a function, as TradingView's manual names them.
function displayName(entry: Entry): string {
  return entry.kind === "function" ? `${entry.id}()` : entry.id;
}

// A summary in a single-line row: Markdown marks and link targets dropped.
function plain(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replaceAll("`", "");
}

function markdownTable(table: NonNullable<Entry["members"]>): string {
  const row = (cells: readonly string[]) =>
    `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
  return [
    row(table.columns),
    row(table.columns.map(() => "---")),
    ...table.rows.map(row),
  ].join("\n");
}
