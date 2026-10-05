# OpenChart

OpenChart is a desktop financial charting application with an integrated AI agent.
It combines market charts, Tea indicators, alerts, and a local workspace.

This is the development and desktop release repository for OpenChart.

## Develop

Install Node 24, Bun 1.4.2, and [Just](https://github.com/casey/just).
Then clone and run from the repository root:

```sh
git clone --recurse-submodules https://github.com/longsurf-ai/openchart.git
cd openchart
just install --frozen-lockfile
just desktop
```

The desktop app requires Clerk sign-in. The checked-in Clerk publishable keys
are public client configuration; account credentials stay outside the repository.

```sh
just check                     # Schema, lint, formatting, types, and tests
just desktop-build             # Build the desktop application
just desktop-package development
```

Tea is a separate public [repository](https://github.com/longsurf-ai/tea), pinned
under `vendor/tea`. `just install` initializes and builds the pinned version.

## Repository

| Directory           | Responsibility                                                     |
| ------------------- | ------------------------------------------------------------------ |
| `app/`              | React interface and application composition                        |
| `server/`           | Local backend, agents, market data, alerts, and SQLite persistence |
| `common/`           | Shared contracts, chart renderer, and utilities                    |
| `platform/desktop/` | Electron host, packaging, signing, and updates                     |
| `vendor/tea/`       | Pinned Tea compiler and runtime                                    |
| `docs/`             | Architecture, authoring, and release instructions                  |

Read the owning directory's `AGENTS.md` before changing code, and
[app/DESIGN.md](app/DESIGN.md) before changing the interface.

## Release

Signed macOS releases are built and published from this repository on an Apple
Silicon signing Mac. Follow the [desktop release runbook](docs/operations/desktop-release.md).
Publishing remains an explicit operator action; merging code runs CI without
publishing an application update. Hosted services and the website are deployed
separately.

## Contribute

Run `just check` before submitting a pull request. CI also checks public content
and credentials. Keep internal plans, private research, local profiles, and
credentials outside this repository. Use English for authored documentation and
comments; real market identifiers and Unicode test cases retain their original text.

## License

See the [OpenChart License](LICENSE) for usage and commercial licensing terms.

Commercial licensing: [legal@longsurf.ai](mailto:legal@longsurf.ai).
