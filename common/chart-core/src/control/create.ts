// Purpose: Factory for creating and retrieving control panel instances (generates UUID, validates input, registers in store)
// Module:  @openchart/chart-core / control

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { fn } from "@openchart/chart-core/util/fn";
import { UUID } from "@openchart/chart-core/util";
import { ControlPanelConfig } from "./config";
import { ControlPanelStore } from "./store";
import { controlPanelHandle } from "./handle";

const CreateInput = z.object({
  state: ControlPanelConfig.State.partial().optional(),
  options: ControlPanelConfig.Options.partial().optional(),
});

export namespace ControlPanel {
  export const create = fn(CreateInput, (input) => {
    const id = UUID.random();
    const state = ControlPanelConfig.State.parse(input.state ?? {});
    const options = ControlPanelConfig.Options.parse(input.options ?? {});

    ControlPanelStore.set(id, {
      id,
      state,
      options,
    });

    return controlPanelHandle(id);
  });

  export function get(id: string) {
    const entry = ControlPanelStore.tryGet(id);
    if (!entry) return null;
    return controlPanelHandle(id);
  }
}
