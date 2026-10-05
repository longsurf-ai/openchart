// Purpose: Indicator inputs show what a run resolved for defaults that follow the chart, and save only choices.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "apache-arrow";
import type * as Tea from "@openchart/tea";
import { expect, it, vi } from "vitest";
import { IndicatorInputsForm } from "@openchart/app/features/chart/components/indicator-inputs-dialog";

const parameter = (fields: Partial<Tea.Parameter>) =>
  ({
    type: "string",
    control: "auto",
    active: null,
    constraints: null,
    enumType: null,
    group: null,
    inline: null,
    tooltip: null,
    confirm: false,
    display: "all",
    seriesSid: null,
    ...fields,
  }) as Tea.Parameter;

// The session profile's inputs: the header's Timeframe and a range whose
// defaults follow the chart, and a constant number of volume bars.
const compiled = {
  declaration: {
    kind: "indicator",
    title: "Session Volume Profile",
    overlay: true,
    timeframe: "auto",
  },
  definition: {
    parameters: [
      parameter({
        name: "timeframe",
        title: "Timeframe",
        control: "timeframe",
        defaultValue: "",
        chartDefault: true,
      }),
      parameter({
        name: "profileRange",
        title: "Profile time range",
        defaultValue: "Daily",
        chartDefault: true,
        constraints: {
          kind: "options",
          options: ["Daily", "Weekly", "Monthly"],
        },
      }),
      parameter({
        name: "rows",
        title: "Number of volume bars",
        type: "int",
        defaultValue: 24,
      }),
    ],
    inputs: new Schema([]),
    outputs: new Schema([]),
    requests: {},
  },
} satisfies Pick<Tea.CompileResponse, "definition" | "declaration">;
const choices = {
  timeframe: [
    { value: "1", name: "1m" },
    { value: "60", name: "1h" },
    { value: "240", name: "4h" },
  ],
};

it("shows a run's values for defaults that follow the chart and saves only choices", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async () => {});
  const view = render(
    <IndicatorInputsForm
      compiled={compiled}
      overrides={{}}
      choices={choices}
      onSave={onSave}
    />,
  );
  // Before a run reports, the host's pick is just the default.
  expect(screen.getByRole("button", { name: "Timeframe" })).toHaveTextContent(
    "Default",
  );
  view.rerender(
    <IndicatorInputsForm
      compiled={compiled}
      overrides={{}}
      resolved={{ timeframe: "60", profileRange: "Monthly", rows: 24 }}
      choices={choices}
      onSave={onSave}
    />,
  );
  expect(screen.getByRole("button", { name: "Timeframe" })).toHaveTextContent(
    "1h",
  );
  expect(
    screen.getByRole("button", { name: "Profile time range" }),
  ).toHaveTextContent("Monthly");
  await user.click(screen.getByRole("button", { name: "Timeframe" }));
  await user.click(screen.getByRole("menuitem", { name: "4h" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  // The range keeps following the chart.
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ timeframe: "240" }),
  );
});
