// Purpose: Collects explicitly registered command definitions without module side effects.
import { assertTrue } from "@openchart/utils/assert";
import { compact } from "./commands/compact";
import { bestOfNCommand } from "./commands/best-of-n";
import { multiTurnDebateCommand } from "./commands/multi-turn-debate";
import { multiAngleResearchCommand } from "./commands/multi-angle-research";
import { thesisKillerCommand } from "./commands/thesis-killer";
import { hypothesisRaceCommand } from "./commands/hypothesis-race";
import { findLaggersCommand } from "./commands/find-laggers";
import type { Definition } from "./definition";

/**
 * Trusted definitions; each command opts in by appearing in this catalog.
 * Preserve concrete builder result types so tRPC can infer reusable input Parts.
 */
export const definitions = [
  compact,
  bestOfNCommand,
  multiTurnDebateCommand,
  multiAngleResearchCommand,
  thesisKillerCommand,
  hypothesisRaceCommand,
  findLaggersCommand,
] as const satisfies readonly Definition[];
/** The sole server-owned lookup; duplicate names are an initialization defect. */
export const catalog = new Map(
  definitions.map((definition) => [definition.name, definition]),
);
assertTrue(catalog.size === definitions.length, "Duplicate slash command name");
