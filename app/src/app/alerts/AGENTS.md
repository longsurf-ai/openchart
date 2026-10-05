# Alerts composition

- `alerts-page.tsx` edits one Rule in SectionPage: `/app/alerts/new` creates,
  `/app/alerts/rules/:ruleId` loads apart from sidebar pagination, and
  `/app/alerts` redirects to `/app/feed`.
- The main sidebar owns Rule navigation; `alert-rule-actions.tsx` guards the
  selected draft before Pause/Enable/Delete and remounts it only after success.
  Its status icon toggles only when healthy or paused, else opens the rule.
  Pending actions never leave newer routes.
- Drafts register with the shell's unsaved guard; accepted navigation resets
  the editor and `initialActionId` focuses its Trigger. Save/Cancel portal into
  SectionPage's footer; Save targets the form.
- Sidebar New Alert and Cmd/Ctrl+A open manual creation; inputs/Monaco/dialogs
  keep native select-all. `new-alert-menu.tsx` Agent creation only prefills
  Copilot, keeping drafts.
- `alert-listing-picker.tsx` adapts Chart SymbolPicker for the root Bars inputs;
  `chooseBarsOptions` owns defaults. `alert-prompt-editor.tsx` injects
  Schedule's AgentPromptEditor; editing never creates Sessions/Runs.
- `chart-alerts.tsx` draws an enabled rule as a line only when `readConditions`
  projects one threshold on price (`alertConfigMarket`) or a followed
  Indicator's output. Copies keep complete definitions.
- `alert-drawing-chart.tsx` renders the saved ChartCell inline in Drawing
  scope, preferring bar settings; only the bound Drawing is editable, and
  geometry autosaves through DrawingSource. Never copy drawings or create
  substitute charts.
- Cross-feature tests live here.
