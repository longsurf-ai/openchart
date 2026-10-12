// Purpose: Verify output/parameter edits, explicit defaults, saved-code lifecycle, and failure-preserving drafts.
import { Field, Float64, Schema } from "apache-arrow";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";
import { FormulaColumnDialog } from "../components/formula-column-dialog";
import type { Column } from "../utils/tree";

vi.mock("@openchart/app/components/ui/code-editor", () => ({
  CodeEditor: ({
    value,
    options,
  }: {
    value: string;
    options: { readOnly: boolean };
  }) => (
    <textarea
      aria-label="Saved code content"
      value={value}
      readOnly={options.readOnly}
    />
  ),
}));

const mocks = vi.hoisted(() => ({ live: vi.fn(), parameters: vi.fn() }));
vi.mock("@openchart/app/hooks/use-tea", () => ({
  useTeaDefinition: () => ({
    pending: false,
    compiled: {
      definition: {
        parameters: mocks.parameters(),
        outputs: new Schema(
          ["value", "signal"].map(
            (name) =>
              new Field(
                name,
                new Float64(),
                true,
                new Map([["tea:write", "set"]]),
              ),
          ),
        ),
      },
    },
  }),
  useTeaSource: () => mocks.live(),
}));
const source = { workspaceId: "wsp_test", path: "rsi.tea" };
const column = {
  id: "wcl_rsi",
  visible: true,
  metric: {
    kind: "formula",
    source,
    snapshot: { "rsi.tea": "code" },
    parameterOverrides: {},
    output: "value",
    bars: { resolution: "1d" },
  },
} as unknown as Column;

beforeEach(() => {
  mocks.parameters.mockReturnValue([
    { name: "length", title: "Length", type: "int", defaultValue: 14 },
  ]);
  mocks.live.mockReturnValue({
    pending: false,
    program: { entry: "rsi.tea", sources: { "rsi.tea": "code" } },
  });
});
function setup(conflict?: "changed" | "removed") {
  const onSave = vi.fn().mockRejectedValue(new Error("Conflict"));
  const onClose = vi.fn();
  const onSuspend = vi.fn();
  const onLoadSaved = vi.fn();
  const openCode = vi.fn();
  const props = {
    target: {
      source: column.metric.kind === "formula" ? column.metric.source : never(),
      column,
      revision: 4,
    },
    open: true,
    conflict,
    onLoadSaved,
    pending: false,
    onSave,
    onClose,
    onSuspend,
    onReload: vi.fn(),
    onRemove: vi.fn(),
  };
  const element = (open = true) => (
    <WorkspaceFileNavigation.Provider value={openCode}>
      <FormulaColumnDialog {...props} open={open} />
    </WorkspaceFileNavigation.Provider>
  );
  const view = render(element());
  return {
    ...view,
    element,
    props,
    onSave,
    onClose,
    onSuspend,
    onLoadSaved,
    openCode,
    user: userEvent.setup(),
  };
}
function never(): never {
  throw new Error("Invalid fixture");
}

test("changing output and numeric overrides saves once against the edited revision and failure retains the draft", async () => {
  const { user, onSave, onClose } = setup();
  await user.click(screen.getByRole("button", { name: "Output" }));
  await user.click(screen.getByRole("menuitem", { name: "signal" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), {
    target: { value: "28" },
  });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      {
        title: undefined,
        output: "signal",
        parameterOverrides: { length: 28 },
        bars: { resolution: "1d" },
      },
      4,
    ),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("spinbutton", { name: "Length" })).toHaveValue(28);
  await user.click(screen.getByRole("button", { name: "Reset Length" }));
  expect(screen.getByRole("spinbutton", { name: "Length" })).toHaveValue(14);
});

test("a source read can be retried without reloading code or losing the settings draft", async () => {
  const retry = vi.fn();
  mocks.live.mockReturnValue({
    pending: false,
    error: new Error("Temporary read failure"),
    retry,
  });
  const { user, props, onSave, rerender, element } = setup();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), {
    target: { value: "21" },
  });
  await user.click(screen.getByRole("button", { name: "Retry source read" }));
  expect(retry).toHaveBeenCalledOnce();
  mocks.live.mockReturnValue({
    pending: false,
    program: { entry: "rsi.tea", sources: { "rsi.tea": "changed code" } },
  });
  rerender(element());
  expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "Length" })).toHaveValue(21);
  expect(props.onReload).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});

test("Open code is a button and suspending settings preserves unsaved overrides", async () => {
  const { user, openCode, onSuspend, onSave, rerender, element } = setup();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), {
    target: { value: "21" },
  });
  const button = screen.getByRole("button", { name: "Open code" });
  expect(button).toHaveAttribute("data-variant", "outline");
  await user.click(button);
  expect(openCode).toHaveBeenCalledWith(source);
  expect(onSuspend).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
  rerender(element(false));
  rerender(element(true));
  expect(screen.getByRole("spinbutton", { name: "Length" })).toHaveValue(21);
});

test("a missing source opens the preserved snapshot read-only without discarding settings", async () => {
  mocks.live.mockReturnValue({
    pending: false,
    error: new Error("File missing"),
  });
  const { user, openCode } = setup();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), {
    target: { value: "21" },
  });
  await user.click(screen.getByRole("button", { name: "Open code" }));
  const editor = await screen.findByRole("textbox", {
    name: "Saved code content",
  });
  expect(editor).toHaveValue("code");
  expect(editor).toHaveAttribute("readonly");
  expect(openCode).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Back to settings" }));
  expect(screen.getByRole("spinbutton", { name: "Length" })).toHaveValue(21);
});

test("a concurrent column edit keeps the draft until replacing it is explicitly confirmed", async () => {
  const { user, onLoadSaved, onSave } = setup("changed");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), {
    target: { value: "21" },
  });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Load saved settings" }));
  expect(onLoadSaved).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Keep draft" }));
  expect(screen.getByRole("spinbutton", { name: "Length" })).toHaveValue(21);
  await user.click(screen.getByRole("button", { name: "Load saved settings" }));
  await user.click(
    screen.getByRole("button", { name: "Discard draft and load" }),
  );
  expect(onLoadSaved).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});

test("failed column removal keeps confirmation and the draft for an explicit retry", async () => {
  const { user, props, onClose, onSave } = setup();
  props.onRemove
    .mockRejectedValueOnce(new Error("Write failed"))
    .mockResolvedValueOnce(undefined);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), {
    target: { value: "21" },
  });
  await user.click(screen.getByRole("button", { name: "Remove column" }));
  expect(props.onRemove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Remove column" }));
  await waitFor(() => expect(props.onRemove).toHaveBeenCalledOnce());
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole("dialog", { name: "Remove column" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("spinbutton", { name: "Length" })).toHaveValue(21);
  await user.click(screen.getByRole("button", { name: "Remove column" }));
  await user.click(screen.getByRole("button", { name: "Remove column" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(props.onRemove).toHaveBeenCalledTimes(2);
  expect(onSave).not.toHaveBeenCalled();
});

test("reloading code with no parameters still allows an orphaned draft override to be removed", async () => {
  mocks.live.mockReturnValue({
    pending: false,
    program: { entry: "rsi.tea", sources: { "rsi.tea": "new code" } },
  });
  const { user, rerender, element, onSave, props } = setup();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), {
    target: { value: "21" },
  });
  props.onReload.mockImplementation(async () => {
    props.target = { ...props.target, revision: 5 };
    mocks.parameters.mockReturnValue([]);
    return { revision: 5 };
  });
  await user.click(screen.getByRole("button", { name: "Reload" }));
  expect(props.onReload).toHaveBeenCalledWith(4);
  rerender(element());
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Remove override" }));
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      {
        title: undefined,
        output: "value",
        parameterOverrides: {},
        bars: { resolution: "1d" },
      },
      5,
    ),
  );
});
