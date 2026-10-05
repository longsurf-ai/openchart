// Purpose: Verify the Tea reference dialog browses pages, searches, follows `#` links and opens at a clicked name.
import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, within } from "@testing-library/react";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { WorkspaceContext } from "@openchart/app/features/workspace/components/context";
import { ReferenceManual } from "@openchart/app/features/workspace/components/reference-manual";

const rpc = vi.hoisted(() => ({ tea: { reference: { query: vi.fn() } } }));
vi.mock("@trpc/client", async (original) => ({
  ...(await original<typeof import("@trpc/client")>()),
  createTRPCClient: () => rpc,
}));
// The manual's highlighting is Shiki's concern; plain code keeps jsdom light.
vi.mock("react-shiki", () => ({ useShikiHighlighter: () => null }));

const entry = {
  parameters: [],
  returns: null,
  members: null,
  body: "",
};
const manual = {
  groups: [
    {
      title: "Built-ins",
      pages: [
        {
          kind: "entries",
          id: "reference/builtins/ta",
          title: "ta",
          description: "Technical analysis.",
          intro: "Available as `ta.name`.",
          commonParameters: [],
          entries: [
            {
              ...entry,
              id: "ta.sma",
              symbols: ["ta.sma"],
              kind: "function",
              category: "Moving averages",
              summary: "Simple moving average; see [`ta.ema`](#ta.ema).",
              signatures: ["ta.sma(source, length)", "ta.sma(source)"],
              parameters: [
                {
                  name: "length",
                  type: null,
                  defaultValue: null,
                  description: "Number of bars.",
                },
              ],
              returns: "The mean.",
            },
            {
              ...entry,
              id: "ta.ema",
              symbols: ["ta.ema"],
              kind: "function",
              category: "Moving averages",
              summary: "Exponential moving average.",
              signatures: ["ta.ema(source, length)"],
              body: "**Formula**\n\n$$\n\\alpha = \\frac{2}{n + 1}\n$$\n\nA price of $5 stays text.",
            },
          ],
        },
        {
          kind: "entries",
          id: "reference/builtins/color",
          title: "color",
          description: "Colors.",
          intro: "",
          commonParameters: [],
          entries: [
            {
              ...entry,
              id: "color.*",
              symbols: ["color.red", "color.green"],
              kind: "constant",
              category: "Palette",
              summary: "Named colors.",
              signatures: [],
            },
          ],
        },
      ],
    },
    {
      title: "Language",
      pages: [
        {
          kind: "article",
          id: "reference/language/control-flow",
          title: "Control flow",
          description: "Branches and loops.",
          markdown: "## `switch`\n\nRuns the first arm that matches.",
        },
      ],
    },
  ],
};

function setup(name?: string) {
  rpc.tea.reference.query.mockResolvedValue(manual);
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider
        value={{
          transport: createTransport({ origin: "http://127.0.0.1:41000" }),
          languageError: undefined,
          onLanguageError: vi.fn(),
          teaSessions: { current: new Map() },
          openReference: vi.fn(),
          saves: { current: new Map() },
          instanceId: "test",
          collapsible: false,
          dark: false,
        }}
      >
        <ReferenceManual name={name} onClose={vi.fn()} />
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  );
  return () => {
    view.unmount();
    client.clear();
  };
}

test("browses pages, searches entries and follows links inside the manual", async () => {
  const cleanup = setup();
  const dialog = await screen.findByRole("dialog");
  // The first page lists its entries.
  expect(await within(dialog).findByText("ta.ema()")).toBeInTheDocument();
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "Search the reference" }),
    { target: { value: "simple" } },
  );
  fireEvent.click(
    await within(dialog).findByRole("button", { name: /ta\.sma\(\)/ }),
  );
  expect(await within(dialog).findByText("2 overloads")).toBeInTheDocument();
  expect(within(dialog).getByText("Syntax & overloads")).toBeInTheDocument();
  expect(within(dialog).getByText("Number of bars.")).toBeInTheDocument();
  // `#ta.ema` opens that entry inside the manual.
  fireEvent.click(within(dialog).getByRole("link", { name: "ta.ema" }));
  expect(
    await within(dialog).findByRole("heading", { name: "ta.ema()" }),
  ).toBeInTheDocument();
  // A `$$` block renders through KaTeX; a single `$` is a dollar sign.
  const formula = within(dialog).getByRole("math", { hidden: true });
  // MathML is an Element, not an HTMLElement supported by jest-dom matchers.
  expect(formula).toHaveProperty("attributes.display.value", "block");
  expect(formula).toHaveProperty(
    "textContent",
    expect.stringContaining("\\alpha = \\frac{2}{n + 1}"),
  );
  expect(
    within(dialog).getByText("A price of $5 stays text."),
  ).toBeInTheDocument();
  cleanup();
});

test("search also finds pages whose text mentions the term", async () => {
  const cleanup = setup();
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(
    await within(dialog).findByRole("textbox", {
      name: "Search the reference",
    }),
    { target: { value: "switch" } },
  );
  const found = await within(dialog).findByRole("list", { name: "Pages" });
  fireEvent.click(within(found).getByRole("button", { name: /Control flow/ }));
  expect(
    await within(dialog).findByText("Runs the first arm that matches."),
  ).toBeInTheDocument();
  cleanup();
});

test("opens at the entry documenting a clicked name", async () => {
  const cleanup = setup("color.red");
  const dialog = await screen.findByRole("dialog");
  expect(
    await within(dialog).findByRole("heading", { name: "color.*" }),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("Named colors.")).toBeInTheDocument();
  cleanup();
});
