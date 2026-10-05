// Purpose: Sound selection persists through Config; local previews stay disposable and never send alerts.
import type { ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  renderWithToaster as render,
  findErrorToast,
} from "@openchart/app/testing/test-utils";
import AlertsSettings from "@openchart/app/app/routes/settings/alerts";

const settings = vi.hoisted(() => ({
  config: { notifications: { sound: "chime" } },
  isSaving: false,
  readError: null as Error | null,
  update: vi.fn(),
}));
vi.mock("react-router", () => ({
  useOutletContext: () => ({ transport: {} }),
}));
vi.mock("@openchart/app/hooks/use-config", () => ({
  useConfig: () => settings,
}));
vi.mock("@openchart/app/app/routes/settings/settings-page", () => ({
  SettingsPage: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));

const players: {
  src: string;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}[] = [];
beforeEach(() => {
  settings.config.notifications.sound = "chime";
  settings.isSaving = false;
  settings.readError = null;
  settings.update.mockReset();
  players.length = 0;
  vi.stubGlobal(
    "Audio",
    class {
      readonly play = vi.fn().mockResolvedValue(undefined);
      readonly pause = vi.fn();
      constructor(readonly src: string) {
        players.push(this);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

test("auditions choices without saving, then persists a choice through Config and stops playback", async () => {
  const user = userEvent.setup();
  const view = render(<AlertsSettings />);
  await user.click(screen.getByRole("button", { name: "Notification sound" }));
  expect(screen.getByRole("radio", { name: "Chime" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Preview Chime" }));
  expect(players[0]!.src).toContain("openchart-chime.wav");
  expect(players[0]!.play).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Preview Glass" }));
  expect(players[0]!.pause).toHaveBeenCalledOnce();
  expect(players[1]!.src).toContain("openchart-glass.wav");
  expect(settings.update).not.toHaveBeenCalled();
  expect(screen.getByRole("radio", { name: "Chime" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "Glass" }));
  expect(settings.update).toHaveBeenLastCalledWith({
    notifications: { sound: "glass" },
  });
  expect(players[1]!.pause).toHaveBeenCalledOnce();
  settings.config.notifications.sound = "glass";
  view.rerender(<AlertsSettings />);
  expect(
    screen.getByRole("button", { name: "Notification sound" }),
  ).toHaveTextContent("Glass");
  await user.click(screen.getByRole("button", { name: "Notification sound" }));
  await user.click(screen.getByRole("radio", { name: "None" }));
  expect(settings.update).toHaveBeenLastCalledWith({
    notifications: { sound: "none" },
  });
  await user.click(screen.getByRole("button", { name: "Notification sound" }));
  await user.click(screen.getByRole("button", { name: "Preview Pluck" }));
  view.unmount();
  expect(players[2]!.pause).toHaveBeenCalledOnce();
});

test("unavailable settings disable controls and playback failures are reported", async () => {
  const view = render(<AlertsSettings />);
  settings.readError = new Error("Unavailable");
  view.rerender(<AlertsSettings />);
  expect(
    screen.getByRole("button", { name: "Notification sound" }),
  ).toBeDisabled();
  settings.readError = null;
  view.rerender(<AlertsSettings />);
  vi.stubGlobal(
    "Audio",
    class {
      play = vi.fn().mockRejectedValue(new Error("Audio unavailable"));
      pause = vi.fn();
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Notification sound" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview Chime" }));
  expect(await findErrorToast("Couldn’t preview sound.")).toHaveTextContent(
    "Audio unavailable",
  );
});
