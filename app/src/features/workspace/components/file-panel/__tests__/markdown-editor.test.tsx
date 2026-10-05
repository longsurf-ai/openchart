import { useState } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import {
  renderWithToaster as render,
  findErrorToast,
} from "@openchart/app/testing/test-utils";
import MarkdownEditor from "@openchart/app/features/workspace/components/file-panel/markdown-editor";

vi.mock(
  "@openchart/app/features/workspace/components/file-panel/crepe-editor",
  () => ({
    default: ({
      value,
      onUnavailable,
    }: {
      value: string;
      onUnavailable: (reason: string | Error) => void;
    }) => (
      <button onClick={() => onUnavailable(new Error("Editor unavailable"))}>
        {value}
      </button>
    ),
  }),
);
vi.mock(
  "@openchart/app/features/workspace/components/file-panel/code-editor",
  () => ({
    default: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (value: string) => void;
    }) => (
      <textarea
        aria-label="Source"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  }),
);

test("initialization failure reports once; retry opens the latest source draft", async () => {
  function Draft() {
    const [value, onChange] = useState("Original draft");
    return (
      <MarkdownEditor
        value={value}
        onChange={onChange}
        path="notes.md"
        workspaceId="wsp_test"
        workspaceRoot="/workspace"
        onOpenFile={() => {}}
      />
    );
  }
  render(<Draft />);
  fireEvent.click(screen.getByRole("button", { name: "Original draft" }));
  const error = await findErrorToast("Editor unavailable");
  expect(screen.getAllByText("Editor unavailable")).toHaveLength(1);
  const source = await screen.findByRole("textbox", { name: "Source" });
  expect(source).toHaveValue("Original draft");
  fireEvent.change(source, { target: { value: "Edited source" } });
  fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("button", { name: "Edited source" }),
  ).toBeVisible();
});
