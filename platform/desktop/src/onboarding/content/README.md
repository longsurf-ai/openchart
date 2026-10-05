# Onboarding content

Desktop installs this snapshot before starting the backend, only when
`<home>/openchart.sqlite3` does not exist. The first window opens Bitcoin with
the saved historical viewport. Chart, Alert, Agent, and database services have
no onboarding branches. Existing profiles, including databases whose content
has been deleted by the user, are left alone.

The SQL is a portable, reviewable database snapshot. `onboarding-content-schema.sql`
freezes the schema and exact migration ledger through
`20260927213244_indicator-resource`. **Do not stamp it with newer migration
checksums or regenerate its schema independently of the data.** Normal database
startup applies every subsequent migration, on both first launch and upgrades.
Tests open this historical snapshot through the current runtime and read its
resources and transcript, so future contract changes must migrate it too.

`onboarding-content.sql` was curated from the installed app's Bitcoin dashboard
and Select & Explain research on September 28, 2026. It retains the event times,
source links, selection binding, RSI snapshot, and relevant resource IDs. The
English annotation copy and demonstration conversation are curated content,
not a new model execution. The chart contains one visible cell and only RSI;
unrelated cells, drawings, chats, credentials, permissions, runs, tool logs,
reasoning, and model requests are excluded. The alert uses BTCUSDT, a daily
crossing at 90,000, once, with notification and Codex research actions. Agent
execution uses the user's normal provider setup; no credentials ship here.

The ray added in the onboarding preview on the same day retains its exact anchors,
style, and linked daily Crossing alert. This second alert fires once with a
notification and the bundled Multi-Angle Research workflow, asking
"should I buy bitcoin right now". The drawing, rule, and both actions retain their
original IDs and references; they use the same portable default workspace.

`studies/` holds the starter studies the new profile owns as ordinary
editable files: a 20-stock semiconductor beta-adjusted relative performance
study and a Tea translation of a Pine Script sector rotation heatmap. Both read
yfinance daily bars through `request.security`, so they need a US equity chart.
They are copied into the default workspace's `studies/` folder before the
database is published, never replacing a file of the same name, and are never
reinstalled once the profile exists.

The only machine-dependent value is supplied by the SQL function
`onboarding_workspace_root()`. Workspace startup installs the normal bundled RSI
file at that root. `view.json` contains ordinary browser preferences, applied only
when absent before the app loads: the chart viewport (not a second chart model)
and the running `starter` onboarding workflow
(`app/src/app/trellis/workflows/starter`), which walks through this
dashboard, transcript and $90,000 alert by ID.

Run `just test-core platform/desktop/src/onboarding/content` from the repository root to verify install,
migrations, content, and historical Tea outputs. `just desktop` uses the same
template and packaging path as release builds. Inspect a fresh temporary Home
and browser profile to review the first-launch experience.
