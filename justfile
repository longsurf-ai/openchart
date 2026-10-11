# Purpose: Development, validation, and desktop release commands for OpenChart.

default: check

# Install OpenChart dependencies and update its lockfile.
install *flags: tea-install
    bun install {{flags}}

# Build the vendored package before Bun copies its public JS/declarations.
tea-install:
    if ! test -f vendor/tea/package.json; then git submodule update --init -- vendor/tea; fi
    npm --prefix vendor/tea ci --ignore-scripts
    npm --prefix vendor/tea run build:package

# Exercise workspace authoring and the real workflow runtime.
workflow-test:
    npm exec vitest -- run server/agent/workflow server/workspace

# Measure Workspace I/O on a reproducible large temporary directory.
workspace-benchmark:
    WORKSPACE_BENCHMARK=1 npm exec vitest -- run server/workspace/benchmark.test.ts

# Run the shared application in Electron; main hosts the OpenChart server in a utility process.
# `just desktop test-account` signs in as the shared Clerk development test user.
desktop *option:
    npm --prefix platform/desktop run dev -- {{option}}

# Start the Agent backend demo or the Access Electron demo.
[arg('name', pattern='agent|access', help='Demo to launch')]
demo name:
    npm --prefix 'demo/{{name}}' run dev

# Build bundled Electron files without a development server.
desktop-build environment="production":
    npm --prefix platform/desktop run build -- '{{environment}}'

# Compile Tea through a relocated desktop backend with only staged runtime assets.
desktop-tea-smoke:
    node --experimental-strip-types platform/desktop/tests/tea-smoke.ts

# Test Tea editing in an isolated profile, optionally against a running Vite URL.
desktop-editor-smoke renderer="":
    node --experimental-strip-types platform/desktop/tests/editor-smoke.ts "{{renderer}}"

# Inspect the study library against the real isolated desktop backend.
desktop-indicator-library-smoke:
    node --experimental-strip-types platform/desktop/tests/indicator-library-smoke.ts

# Refresh bundled historical study examples; --verify checks provider history without writing.
indicator-examples *flags:
    app/node_modules/.bin/tsx server/indicators/capture-examples.ts {{flags}}

# Verify or select educational windows from the packaged historical captures.
indicator-study-windows *flags:
    app/node_modules/.bin/tsx server/indicators/select-study-windows.ts {{flags}}

# Package the complete app; use development for test credentials without HMR.
desktop-package environment="production" target="" signing="signed":
    npm --prefix platform/desktop run package -- '{{environment}}' '{{target}}' '{{signing}}'

# Produce native installers and update files; Windows test builds use explicit unsigned mode.
desktop-release target="darwin-arm64" signing="signed":
    npm --prefix platform/desktop run release -- '{{target}}' '{{signing}}'

# Upload verified downloads, then the update manifest, then the GitHub Release.
[arg('version', pattern='[0-9]+\.[0-9]+\.[0-9]+')]
desktop-publish version *options:
    node --experimental-strip-types platform/desktop/scripts/publish.ts '{{version}}' {{options}}

# Verify a packaged Electron executable; all test data stays in a temporary profile.
[arg('keychain', pattern='mock|system')]
desktop-smoke executable environment="production" keychain="mock":
    npm --prefix platform/desktop run smoke -- '{{executable}}' '{{environment}}' '{{keychain}}'

# Probe native Windows sign-in, then remove its fixture after the native owner exits.
desktop-windows-probe:
    node --experimental-strip-types platform/desktop/tests/windows-runtime-probe.ts

# Run every OpenChart check once in parallel; every dependency must succeed.
[parallel]
check: check-static typecheck test

# Validate schema drift, lint, and formatting for OpenChart.
check-static:
    npm run check:static

# Migration generation contract:
#
# `name` is the descriptive suffix in `<timestamp>_<name>.ts`.
# Drizzle compares declarations in `server/agent/**/schema.ts`,
# `server/resources/**/schema.ts`, and `server/access/credential/schema.ts` with
# `server/db/schema.json`, which records the schema state after the latest
# generated migration.
#
# When a schema difference exists, this command writes one new migration under
# `server/db/migration/` and advances `server/db/schema.json`. It always rebuilds
# `server/db/schema.gen.ts` for fresh databases and `server/db/migration.gen.ts`
# for the ordered migration registry and source checksums.
#
# This command generates artifacts only; it does not open an application
# database or apply migrations. Schema DDL is generated rather than handwritten.
# Add required data backfills or persisted-JSON transformations to the newly
# generated migration before it can reach a durable database. Once a migration
# may have been applied, never edit, delete, rename, or reorder it; create a new
# forward migration instead. If a new migration receives a handwritten data
# step, rerun this command to refresh its registry checksum, then run
# `just check`.
#
# Generate one forward-only SQLite migration from the application schemas.
# `hints` answers drizzle-kit's rename prompts as JSON, e.g.
# '[{"type":"create","kind":"table","entity":["public","indicator"]}]'.
migration name hints="":
    npm --prefix server run db:generate -- --name {{name}} {{ if hints == "" { "" } else { "--hints " + quote(hints) } }}

# Lint every OpenChart source file.
lint:
    npm run lint

# Apply safe ESLint fixes to every OpenChart source file.
lint-fix:
    npm run lint:fix

# Check formatting with the one OpenChart Prettier policy.
format:
    npm run format

# Format selected OpenChart files, or all files when omitted.
format-fix *files=".":
    npm exec prettier -- --write {{files}}

# Apply lint fixes, then format.
fix:
    npm run fix

# Run all OpenChart tests with Vitest.
test:
    npm test

# Run selected app tests. Paths are relative to app/.
[working-directory: "app"]
test-app *files:
    npm exec vitest -- run {{files}}

# Run selected common/server tests without starting the app suites.
test-core *files:
    npm run test:core -- {{files}}

# The vendored Tea toolchain owns its independent test configuration.
tea-test *files:
    npm --prefix vendor/tea test -- {{files}}

# Type-check the independently packaged Tea runtime and compiler.
tea-typecheck:
    npm --prefix vendor/tea run typecheck

# Run Tea's standalone compiler/runtime/package/documentation gate.
tea-check:
    npm --prefix vendor/tea run check

# Build Tea's JavaScript and declaration package boundary.
tea-build:
    npm --prefix vendor/tea run build:package

# Preview Tea's documentation site with live reload and open it in the browser.
tea-docs:
    npm --prefix vendor/tea run docs:dev

# Refresh the committed Tea reference from its documented source declarations.
tea-docs-generate:
    npm --prefix vendor/tea run docs:generate

# Format selected files with Tea's independent formatting policy.
tea-format *files:
    cd vendor/tea && npm exec prettier -- --write {{files}}

# Type-check every OpenChart workspace.
typecheck:
    npm run typecheck
