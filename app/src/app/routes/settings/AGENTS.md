# Settings presentation

- Reuse the shared PageHeader, section menu, Card/CardItem and form controls;
  no lookalike forms.
- SettingsPage composes shared `SectionPage`: `PageHeader`, a 232px
  category rail and independently scrolling content, with a
  DropdownControl on narrow screens. Alerts uses the same frame; change it there.
- settingsSections owns UI routes, labels, icons and order, never persisted
  configuration. Config remains backend truth.
- Profile shows read-only Clerk identity and sign-out; account data stays out of Config.
- Subscription scopes Billing to the gated account; neither lives in Config.
- Data Provider actions come from provider-owned access checks, including while
  disabled. Errors offer retry; billing actions route to Subscription.
  Subscription changes refresh activation without changing enabled preferences.
- Changelog uses Desktop-bundled AppHost entries; never fetch release notes.
  Use a version/date rail and bullets in one settings Card.
- Query hooks own reads and saves; page state holds only unsubmitted drafts.
  Keep Config, Integration credentials and model discovery separate.
- Unknown/unavailable providers remain configurable. Never derive navigation
  from discovered models; add dynamic metadata only with dynamic registration.
- Disabled, failed-read, failed-save and retry states remain visible. SecretInput
  only reveals/copies the user's current draft, never a saved backend secret.
