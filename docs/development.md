# Develop OpenChart

This repository contains the OpenChart desktop application and its local server.

## Run from source

Install Git, [Node.js 24](https://nodejs.org/en/download),
[npm 11.11.1](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/),
[Bun 1.4.2](https://bun.sh/docs/installation), and [Just](https://just.systems/man/en/).
Tea requires npm 11.11.1 or a later 11.x release; if needed, update npm with
`npm install --global npm@11.11.1`.

```sh
git clone https://github.com/longsurf-ai/openchart.git
cd openchart
just install --frozen-lockfile
just desktop
```

Run commands from the repository root. `just install` initializes the pinned
[Tea submodule](https://github.com/longsurf-ai/tea), installs its dependencies,
builds its package, and installs the OpenChart workspaces. A separate recursive
clone is not required.

`just desktop` starts Electron and the local server, with live updates to the
interface during development. The app requires Clerk sign-in. Its checked-in
publishable keys are public client configuration; credentials stay outside the
repository. Follow the [Desktop setup guide](https://openchart.co/docs/getting-started/)
to connect an agent and select data providers.

## Build

To host OpenChart locally, run the desktop app from source as described above.
Desktop hosts the server and stores the workspace locally. Account sign-in,
agent providers, and remote market-data services still require their respective
connections.

After installing dependencies, build the desktop bundles without starting the
development server:

```sh
just desktop-build
```

To create a local development package:

```sh
just desktop-package development
```

Generated bundles go to `platform/desktop/dist/`; packaged applications go to
`platform/desktop/out/`. The development package uses development sign-in
configuration. Official signed downloads currently target macOS on Apple Silicon.

For signed, notarized macOS releases, follow the
[desktop release runbook](operations/desktop-release.md). Publishing is an
explicit operator action: merging code runs CI without publishing an application
update. Hosted services and the website are deployed separately.

## Repository

| Directory           | Responsibility                                                     |
| ------------------- | ------------------------------------------------------------------ |
| `app/`              | React interface and application composition                        |
| `server/`           | Local backend, agents, market data, alerts, and SQLite persistence |
| `common/`           | Shared contracts, chart renderer, and utilities                    |
| `platform/desktop/` | Electron host, packaging, signing, and updates                     |
| `vendor/tea/`       | Pinned Tea compiler and runtime                                    |
| `docs/`             | Architecture, authoring, and release instructions                  |

Read the owning directory's `AGENTS.md` and the
[code organization guide](architecture/code-organization.md) before changing code.
Read [app/DESIGN.md](../app/DESIGN.md) before changing the interface.

## Checks and contributions

```sh
just check                     # Schema, lint, formatting, types, and tests
just format-fix path/to/file    # Format only the files you changed
```

Run `just check` before submitting a pull request. CI also checks public content
and credentials. Keep internal plans, private research, local profiles, and
credentials outside this repository. Use English for authored documentation and
comments; real market identifiers and Unicode test cases retain their original
text. Preserve human annotations as described in [AGENTS.md](../AGENTS.md).

Tea is maintained in its own repository. Follow its contribution instructions
for language changes, then update OpenChart's submodule pin when appropriate.
