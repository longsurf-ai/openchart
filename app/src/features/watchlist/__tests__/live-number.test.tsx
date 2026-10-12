// Purpose: Changed digits stay coloured until the next displayed live value.
import { render, within } from "@testing-library/react";

import { LiveNumber } from "../components/live-number";

const changedDigits = (element: HTMLElement, tone?: string) =>
  within(element)
    .queryAllByText(/./u, {
      selector: tone ? `.${tone}` : ".text-up, .text-down",
    })
    .map((digit) => digit.textContent)
    .join("");

test("retains highlights until the next displayed change, comparing successive values", () => {
  const view = render(<LiveNumber value={742.95} text="742.95" />);
  expect(changedDigits(view.container)).toBe("");

  view.rerender(<LiveNumber value={742.96} text="742.96" />);
  expect(view.container).toHaveTextContent("742.96");
  expect(changedDigits(view.container, "text-up")).toBe("6");

  view.rerender(<LiveNumber value={742.961} text="742.96" />);
  expect(changedDigits(view.container, "text-up")).toBe("6");

  view.rerender(<LiveNumber value={742.86} text="742.86" />);
  expect(changedDigits(view.container)).toBe("8");
  expect(changedDigits(view.container, "text-down")).toBe("8");
});

test.each([
  [999.25, "999.25", 1000.25, "1,000.25", "1000", "text-up"],
  [0.9999, "0.9999", 1, "1.00", "100", "text-up"],
  [1.23, "1.23", 1.230001, "1.230001", "0001", "text-up"],
  [-1.25, "-1.25", -1.35, "-1.35", "3", "text-down"],
] as const)(
  "compares %s (%s) with %s (%s) by decimal place",
  (previous, before, value, text, changed, tone) => {
    const view = render(<LiveNumber value={previous} text={before} />);
    view.rerender(<LiveNumber value={value} text={text} />);
    expect(view.container).toHaveTextContent(text);
    expect(changedDigits(view.container)).toBe(changed);
    expect(changedDigits(view.container, tone)).toBe(changed);
  },
);
