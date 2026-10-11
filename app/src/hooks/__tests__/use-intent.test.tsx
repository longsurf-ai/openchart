// Purpose: Prove widgets raise and answer intents through the nearest router as their placement.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type PropsWithChildren } from "react";

import {
  useIntent,
  useIntentActivation,
  useIntentHandler,
} from "@openchart/app/hooks/use-intent";
import {
  defineIntent,
  type IntentOutcome,
} from "@openchart/app/lib/widget/intent/intent";
import { WidgetIntentProvider } from "@openchart/app/lib/widget/intent/provider";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { WidgetContext } from "@openchart/app/lib/widget/widget";

const show = defineIntent<{ symbol: string }>("Show", { delivery: "each" });

function Placement({ id, children }: PropsWithChildren<{ id: string }>) {
  return (
    <WidgetContext.Provider
      value={{
        placementId: id,
        dashboardId: "dsh_test",
        transport: {} as AppTransport,
        holdControls: () => () => {},
        placeBeside: vi.fn(),
      }}
    >
      {children}
    </WidgetContext.Provider>
  );
}

function Source({
  onOutcome,
}: {
  onOutcome: (outcome: IntentOutcome) => void;
}) {
  const chart = useIntent(show);
  return (
    <button
      data-available={chart.available}
      onClick={() => void chart.raise({ symbol: "AAPL" }).then(onOutcome)}
    >
      Show AAPL
    </button>
  );
}

function Answer({
  label,
  onShow,
}: {
  label: string;
  onShow: (line: string) => void;
}) {
  useIntentHandler(show, ({ symbol }, source) =>
    onShow(`${label} ${symbol} from ${source.placementId}`),
  );
  const activate = useIntentActivation(`wdg_${label}`);
  return <button onClick={activate}>Activate {label}</button>;
}

function Toggle({ children }: PropsWithChildren) {
  const [shown, setShown] = useState(true);
  return (
    <>
      <button onClick={() => setShown(!shown)}>Toggle</button>
      {shown ? children : null}
    </>
  );
}

const source = () => screen.getByRole("button", { name: "Show AAPL" });

test("a source sees availability follow the handler's lifetime and reaches it as its placement", async () => {
  const shown = vi.fn();
  const outcomes = vi.fn();
  const user = userEvent.setup();
  render(
    <WidgetIntentProvider>
      <Placement id="wdg_list">
        <Source onOutcome={outcomes} />
      </Placement>
      <Toggle>
        <Placement id="wdg_chart">
          <Answer label="chart" onShow={shown} />
        </Placement>
      </Toggle>
    </WidgetIntentProvider>,
  );
  expect(source()).toHaveAttribute("data-available", "true");
  await user.click(source());
  await waitFor(() =>
    expect(outcomes).toHaveBeenCalledWith({
      status: "handled",
      placementId: "wdg_chart",
    }),
  );
  expect(shown).toHaveBeenCalledExactlyOnceWith("chart AAPL from wdg_list");

  await user.click(screen.getByRole("button", { name: "Toggle" }));
  expect(source()).toHaveAttribute("data-available", "false");
  await user.click(source());
  await waitFor(() =>
    expect(outcomes).toHaveBeenLastCalledWith({ status: "unavailable" }),
  );
});

test("the latest handler closure answers without registering again", async () => {
  const outcomes = vi.fn();
  const first = vi.fn();
  const second = vi.fn();
  const user = userEvent.setup();
  const tree = (onShow: (line: string) => void) => (
    <WidgetIntentProvider>
      <Placement id="wdg_list">
        <Source onOutcome={outcomes} />
      </Placement>
      <Placement id="wdg_chart">
        <Answer label="chart" onShow={onShow} />
      </Placement>
    </WidgetIntentProvider>
  );
  const view = render(tree(first));
  view.rerender(tree(second));
  await user.click(source());
  await waitFor(() => expect(second).toHaveBeenCalledOnce());
  expect(first).not.toHaveBeenCalled();
});

test("working in a placement makes it the one that answers", async () => {
  const shown = vi.fn();
  const user = userEvent.setup();
  render(
    <WidgetIntentProvider>
      <Placement id="wdg_list">
        <Source onOutcome={vi.fn()} />
      </Placement>
      <Placement id="wdg_left">
        <Answer label="left" onShow={shown} />
      </Placement>
      <Placement id="wdg_right">
        <Answer label="right" onShow={shown} />
      </Placement>
    </WidgetIntentProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Activate right" }));
  await user.click(source());
  await waitFor(() =>
    expect(shown).toHaveBeenLastCalledWith("right AAPL from wdg_list"),
  );
  await user.click(screen.getByRole("button", { name: "Activate left" }));
  await user.click(source());
  await waitFor(() =>
    expect(shown).toHaveBeenLastCalledWith("left AAPL from wdg_list"),
  );
});

test("without a router nothing answers and raising settles as unavailable", async () => {
  const outcomes = vi.fn();
  const shown = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <Placement id="wdg_list">
        <Source onOutcome={outcomes} />
      </Placement>
      <Placement id="wdg_chart">
        <Answer label="chart" onShow={shown} />
      </Placement>
    </>,
  );
  expect(source()).toHaveAttribute("data-available", "false");
  await user.click(source());
  await waitFor(() =>
    expect(outcomes).toHaveBeenCalledWith({ status: "unavailable" }),
  );
  await user.click(screen.getByRole("button", { name: "Activate chart" }));
  expect(shown).not.toHaveBeenCalled();
});
