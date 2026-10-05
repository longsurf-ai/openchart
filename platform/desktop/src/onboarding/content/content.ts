// Purpose: Install a frozen, portable database template before the application opens it.

import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import view from "./view.json";

/** First-window location and ordinary browser preferences, only for a new profile. */
export interface OnboardingContentView {
  readonly path: string;
  readonly localStorage: Readonly<Record<string, string>>;
}

/**
 * Installs the bundled snapshot only when the profile has no application database.
 * Builds and closes a temporary database before publishing it with an exclusive,
 * atomic hard link. Existing files (including empty databases) are never opened
 * or replaced. Failures leave the destination absent and can be retried.
 *
 * The application subsequently owns this file and runs its ordinary migrations;
 * this installer imports no application services or current schema definitions.
 * The caller must invoke it before starting the backend. Temporary files are
 * removed on completion or failure; filesystem and SQLite failures propagate.
 *
 * @example const firstWindow = await prepareOnboardingContent(home);
 */
export async function prepareOnboardingContent(
  home: string,
): Promise<OnboardingContentView | undefined> {
  await mkdir(home, { recursive: true });
  const root = await realpath(home);
  const destination = join(root, "openchart.sqlite3");
  try {
    await lstat(destination);
    return undefined;
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
      throw cause;
  }

  const directory = await mkdtemp(join(root, ".onboarding-content-"));
  try {
    const [schema, content] = await Promise.all([
      readFile(
        join(import.meta.dirname, "onboarding-content-schema.sql"),
        "utf8",
      ),
      readFile(join(import.meta.dirname, "onboarding-content.sql"), "utf8"),
    ]);
    const filename = join(directory, "openchart.sqlite3");
    const database = new DatabaseSync(filename);
    try {
      database.function("onboarding_workspace_root", () =>
        join(root, "workspaces", "default"),
      );
      database.exec(
        `PRAGMA foreign_keys = ON; BEGIN;\n${schema}\n${content}\nCOMMIT;`,
      );
    } finally {
      database.close();
    }
    try {
      await link(filename, destination);
    } catch (cause) {
      // Another first launch may have finished while this snapshot was built.
      if (cause instanceof Error && "code" in cause && cause.code === "EEXIST")
        return undefined;
      throw cause;
    }
    return {
      path: view.path,
      localStorage: Object.fromEntries(
        Object.entries(view.localStorage).map(([key, value]) => [
          key,
          JSON.stringify(value),
        ]),
      ),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
