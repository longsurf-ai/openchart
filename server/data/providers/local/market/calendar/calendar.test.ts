// Purpose: Verifies calendar reads and constraints against SQLite generated from the owning schemas.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { Effect, Scope, Exit } from "effect";
import type { SelectQuery } from "@openchart/server/data/dataset";
import type { calendar } from "@openchart/server/data/providers/local";
import { drizzle } from "drizzle-orm/node-sqlite";
import { afterEach, beforeAll, expect, test } from "vitest";

import { makeCalendarDataset } from "./index";
import { readCalendarData } from "./data";
import {
  tradingCalendars,
  tradingSessionRules,
  tradingCalendarOverrides,
} from "./schema";

const execute = promisify(execFile);
const directories: string[] = [];
const scopes: Scope.Closeable[] = [];
const realSnapshot = process.env.CALENDAR_DATASET_PATH;
let schema: string;
beforeAll(async () => {
  const server = resolve(import.meta.dirname, "../../../../..");
  const result = await execute(
    process.execPath,
    [
      "node_modules/drizzle-kit/bin.cjs",
      "export",
      "--dialect",
      "sqlite",
      "--schema",
      "data/providers/local/market/calendar/schema.ts",
    ],
    { cwd: server },
  );
  schema = result.stdout;
});
afterEach(async () => {
  for (const scope of scopes.splice(0))
    await Effect.runPromise(Scope.close(scope, Exit.void));
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

if (realSnapshot) {
  test("reads the real calendar snapshot through Catalog", async () => {
    const calendar = dataset(realSnapshot);
    const rows = await calendar.select({
      calendar: "NYSE",
      time: {
        from: Date.parse("2026-11-26T05:00Z"),
        to: Date.parse("2026-11-28T05:00Z"),
      },
    });
    expect(rows.map((row) => row.date)).toEqual(["2026-11-26", "2026-11-27"]);
    expect(rows[0]).toMatchObject({ holiday: "Thanksgiving", sessions: [] });
    expect(
      rows[1]?.sessions.find((session) => session.type === "regular"),
    ).toEqual({
      type: "regular",
      start: Date.parse("2026-11-27T14:30Z"),
      end: Date.parse("2026-11-27T18:00Z"),
    });
  });
}

/** Builds local calendar data from the production Drizzle schema. */
function snapshot(edit?: (database: DatabaseSync) => void): string {
  const directory = mkdtempSync(join(tmpdir(), "v2-calendar-"));
  directories.push(directory);
  const path = join(directory, "local-datasets.sqlite3");
  const database = drizzle(path);
  try {
    database.$client.exec(schema);
    database
      .insert(tradingCalendars)
      .values(
        [
          {
            calendarId: 1,
            sourceCalendarId: null,
            name: "NYSE",
            timezone: "America/New_York",
          },
          {
            calendarId: 2,
            sourceCalendarId: 1,
            name: "Inherited",
            timezone: "America/New_York",
          },
          {
            calendarId: 3,
            sourceCalendarId: null,
            name: "24/7",
            timezone: "UTC",
          },
          {
            calendarId: 4,
            sourceCalendarId: null,
            name: "Night",
            timezone: "America/Chicago",
          },
          {
            calendarId: 5,
            sourceCalendarId: null,
            name: "DST",
            timezone: "America/New_York",
          },
        ].map((row) => ({
          ...row,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        })),
      )
      .run();
    database
      .insert(tradingCalendarOverrides)
      .values([
        {
          calendarId: 1,
          date: "2026-11-26",
          overrideType: "closed",
          name: "Thanksgiving",
        },
        {
          calendarId: 1,
          date: "2026-11-27",
          overrideType: "early_close",
          name: "Thanksgiving",
          closeTime: "13:00:00",
        },
        {
          calendarId: 2,
          date: "2026-11-30",
          overrideType: "late_open",
          openTime: "10:00:00",
        },
      ])
      .run();
    const rules: (typeof tradingSessionRules.$inferInsert)[] = [
      {
        calendarId: 4,
        sessionType: "regular",
        dayOfWeek: 6,
        openTime: "17:00:00",
        closeTime: "16:00:00",
        crossesMidnight: 1,
      },
    ];
    for (let weekday = 0; weekday < 7; weekday++) {
      for (const calendarId of [3, 5])
        rules.push({
          calendarId,
          sessionType: "regular",
          dayOfWeek: weekday,
          openTime: "00:00:00",
          closeTime: "00:00:00",
          crossesMidnight: 1,
        });
      if (weekday > 4) continue;
      rules.push(
        {
          calendarId: 1,
          sessionType: "pre",
          dayOfWeek: weekday,
          openTime: "04:00:00",
          closeTime: "09:30:00",
        },
        {
          calendarId: 1,
          sessionType: "regular",
          dayOfWeek: weekday,
          openTime: "09:30:00",
          closeTime: "16:00:00",
        },
        {
          calendarId: 1,
          sessionType: "post",
          dayOfWeek: weekday,
          openTime: "16:00:00",
          closeTime: "20:00:00",
        },
      );
    }
    database.insert(tradingSessionRules).values(rules).run();
    edit?.(database.$client);
  } finally {
    database.$client.close();
  }
  return path;
}

function dataset(path: string) {
  const database = drizzle({ connection: { path, readOnly: true } });
  try {
    const scope = Scope.makeUnsafe();
    scopes.push(scope);
    const access = Effect.runSync(
      makeCalendarDataset(database).pipe(
        Effect.provideService(Scope.Scope, scope),
      ),
    );
    return {
      select: (query: SelectQuery<typeof calendar>) =>
        Effect.runPromise(access.select(query)),
    };
  } finally {
    database.$client.close();
  }
}

test("generates local tables with keys and constraints, outside the application schema", () => {
  const path = snapshot();
  const database = drizzle({ connection: { path, readOnly: true } });
  try {
    expect(
      database
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
        )
        .map((row) => row.name),
    ).toEqual([
      "trading_calendar_overrides",
      "trading_calendars",
      "trading_session_rules",
    ]);
    expect(
      database.all("PRAGMA foreign_key_list(trading_session_rules)"),
    ).toHaveLength(1);
    expect(
      database.all("PRAGMA foreign_key_list(trading_calendars)"),
    ).toHaveLength(1);
    expect(() => database.delete(tradingCalendars).run()).toThrow();
    expect(readCalendarData(database).calendars).toHaveLength(5);
  } finally {
    database.$client.close();
  }
  expect(() =>
    snapshot((db) =>
      db.exec(
        "UPDATE trading_calendars SET name = 'NYSE' WHERE calendar_id = 2",
      ),
    ),
  ).toThrow();
  expect(() =>
    snapshot((db) =>
      db.exec("UPDATE trading_session_rules SET day_of_week = 7"),
    ),
  ).toThrow();
});

test.each([
  "DROP TABLE trading_calendar_overrides",
  "PRAGMA ignore_check_constraints = ON; UPDATE trading_session_rules SET crosses_midnight = 2",
  "PRAGMA foreign_keys = OFF; UPDATE trading_calendars SET source_calendar_id = 99 WHERE calendar_id = 2",
  "UPDATE trading_calendar_overrides SET close_time = NULL WHERE override_type = 'early_close'",
  "UPDATE trading_calendar_overrides SET date = '2026-02-30' WHERE calendar_id = 2",
  "UPDATE trading_calendar_overrides SET override_type = 'special'",
])(
  "rejects unreadable or invalid local data at the Drizzle boundary: %s",
  (sql) => {
    const path = snapshot((db) => db.exec(sql));
    expect(() => dataset(path)).toThrow("Dataset.InvalidResult");
  },
);

test("reads source data without writes and applies inheritance, closures, and changed hours", async () => {
  const path = snapshot();
  const before = readFileSync(path);
  const calendar = dataset(path);
  const rows = await calendar.select({
    calendar: "Inherited",
    time: {
      from: Date.parse("2026-11-26T05:00Z"),
      to: Date.parse("2026-12-01T05:00Z"),
    },
  });
  expect(rows.map((row) => row.date)).toEqual([
    "2026-11-26",
    "2026-11-27",
    "2026-11-28",
    "2026-11-29",
    "2026-11-30",
  ]);
  expect(rows[0]).toMatchObject({ holiday: "Thanksgiving", sessions: [] });
  expect(rows[1]?.sessions).toEqual([
    {
      type: "pre",
      start: Date.parse("2026-11-27T09:00Z"),
      end: Date.parse("2026-11-27T14:30Z"),
    },
    {
      type: "regular",
      start: Date.parse("2026-11-27T14:30Z"),
      end: Date.parse("2026-11-27T18:00Z"),
    },
    {
      type: "post",
      start: Date.parse("2026-11-27T18:00Z"),
      end: Date.parse("2026-11-28T01:00Z"),
    },
  ]);
  expect(rows[2]?.sessions).toEqual([]);
  expect(rows[4]?.sessions[1]?.start).toBe(Date.parse("2026-11-30T15:00Z"));
  expect(readFileSync(path)).toEqual(before);
});

test("handles DST as local dates and preserves full overlapping source sessions", async () => {
  const calendar = dataset(snapshot());
  const spring = await calendar.select({
    calendar: "DST",
    time: {
      from: Date.parse("2026-03-08T05:00Z"),
      to: Date.parse("2026-03-09T04:00Z"),
    },
  });
  expect(spring).toHaveLength(1);
  expect(spring[0]?.sessions[0]).toMatchObject({
    start: Date.parse("2026-03-08T05:00Z"),
    end: Date.parse("2026-03-09T04:00Z"),
  });
  const autumn = await calendar.select({
    calendar: "DST",
    time: {
      from: Date.parse("2026-11-01T04:00Z"),
      to: Date.parse("2026-11-02T05:00Z"),
    },
  });
  expect(autumn[0]?.sessions[0]).toMatchObject({
    start: Date.parse("2026-11-01T04:00Z"),
    end: Date.parse("2026-11-02T05:00Z"),
  });
  const overnight = await calendar.select({
    calendar: "Night",
    time: {
      from: Date.parse("2026-11-30T06:00Z"),
      to: Date.parse("2026-11-30T12:00Z"),
    },
  });
  expect(overnight.map((row) => row.date)).toEqual([
    "2026-11-29",
    "2026-11-30",
  ]);
  expect(overnight[0]?.sessions[0]).toEqual({
    type: "regular",
    start: Date.parse("2026-11-29T23:00Z"),
    end: Date.parse("2026-11-30T22:00Z"),
  });
  expect(overnight[1]?.sessions).toEqual([]);
});

test("uses query bounds or count without a configured coverage window", async () => {
  const calendar = dataset(snapshot());
  const time = {
    from: Date.parse("2026-11-25T00:00Z"),
    to: Date.parse("2026-12-01T00:00Z"),
  };
  expect(
    await calendar.select({ calendar: "24/7", time, count: 10 }),
  ).toHaveLength(6);
  expect(
    (await calendar.select({ calendar: "24/7", time, count: 2 })).map(
      (row) => row.date,
    ),
  ).toEqual(["2026-11-25", "2026-11-26"]);
  expect(
    await calendar.select({
      calendar: "24/7",
      time: { from: Date.parse("2026-11-29T00:00Z") },
      count: 2,
    }),
  ).toHaveLength(2);
  expect(
    await calendar.select({
      calendar: "24/7",
      time: { from: time.from, to: Date.parse("2026-11-27T00:00Z") },
    }),
  ).toHaveLength(2);
  await expect(
    calendar.select({
      calendar: "24/7",
      time: { from: Date.parse("2025-01-01T00:00Z") },
      count: 1,
    }),
  ).resolves.toMatchObject([{ date: "2025-01-01" }]);
  await expect(
    calendar.select({
      calendar: "24/7",
      time: { from: time.from, to: time.from },
    }),
  ).resolves.toEqual([]);
  await expect(
    calendar.select({ calendar: "24/7", time: { from: 2, to: 1 } }),
  ).rejects.toMatchObject({
    reason: { _tag: "Dataset.InvalidQuery" },
  });
  await expect(
    calendar.select({ calendar: "unknown", time: {}, count: 1 }),
  ).rejects.toMatchObject({
    reason: { _tag: "Dataset.NotFound" },
  });
});

test("uses database exceptions beyond the previous configured dates", async () => {
  const calendar = dataset(
    snapshot((client) => {
      drizzle({ client })
        .insert(tradingCalendarOverrides)
        .values({
          calendarId: 1,
          date: "2035-01-01",
          overrideType: "closed",
          name: "Stored holiday",
        })
        .run();
    }),
  );
  const rows = await calendar.select({
    calendar: "Inherited",
    time: {
      from: Date.parse("2035-01-01T05:00Z"),
      to: Date.parse("2035-01-02T05:00Z"),
    },
  });
  expect(rows).toMatchObject([
    { date: "2035-01-01", holiday: "Stored holiday", sessions: [] },
  ]);
});

test("rejects queries that cannot finitely select recurring rules", async () => {
  const calendar = dataset(snapshot());
  for (const time of [{}, { to: Date.parse("2026-11-27T00:00Z") }]) {
    await expect(
      calendar.select({ calendar: "24/7", time, count: 2 }),
    ).rejects.toMatchObject({
      reason: { _tag: "Dataset.InvalidQuery" },
    });
  }
  await expect(
    calendar.select({
      calendar: "24/7",
      time: { from: Date.parse("2026-11-27T00:00Z") },
    }),
  ).rejects.toMatchObject({
    reason: { _tag: "Dataset.InvalidQuery" },
  });
});

test("rejects cyclic inheritance, overlaps, and invalid local times", async () => {
  const invalid = [
    "UPDATE trading_calendars SET source_calendar_id = 2 WHERE calendar_id = 1",
    "UPDATE trading_session_rules SET close_time = '10:00:00' WHERE calendar_id = 1 AND session_type = 'pre'",
    "UPDATE trading_calendars SET timezone = 'Invalid/Zone' WHERE calendar_id = 1",
    "UPDATE trading_session_rules SET open_time = '02:30:00' WHERE calendar_id = 5 AND day_of_week = 6",
  ];
  for (const sql of invalid) {
    const calendar = dataset(snapshot((database) => database.exec(sql)));
    await expect(
      calendar.select({
        calendar: sql.includes("calendar_id = 5") ? "DST" : "NYSE",
        time: {
          from: Date.parse("2026-03-08T05:00Z"),
          to: Date.parse("2026-03-10T04:00Z"),
        },
      }),
    ).rejects.toMatchObject({
      reason: { _tag: "Dataset.InvalidResult" },
    });
  }
});

test("stores and expands overnight sessions that cross midnight", async () => {
  const calendar = dataset(
    snapshot((client) => {
      drizzle({ client })
        .insert(tradingSessionRules)
        .values({
          calendarId: 1,
          sessionType: "overnight",
          dayOfWeek: 6,
          openTime: "21:00:00",
          closeTime: "04:00:00",
          crossesMidnight: 1,
        })
        .run();
    }),
  );
  const [sunday] = await calendar.select({
    calendar: "NYSE",
    time: {
      from: Date.parse("2026-12-06T05:00Z"),
      to: Date.parse("2026-12-07T05:00Z"),
    },
  });
  expect(sunday).toMatchObject({
    date: "2026-12-06",
    sessions: [
      {
        type: "overnight",
        start: Date.parse("2026-12-07T02:00Z"),
        end: Date.parse("2026-12-07T09:00Z"),
      },
    ],
  });
});
