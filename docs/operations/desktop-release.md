# Desktop release runbook

OpenChart packages Apple Silicon Mac (`darwin-arm64`), Intel Mac (`darwin-x64`),
and Windows Intel/AMD (`win32-x64`). Build both Mac targets on a signing Mac and
Windows on Windows. Run repository commands from the root. Packaging, verification
and publication are separate steps; merging a PR does not publish an update.

The pinned [Electron 44 runtime](https://github.com/electron/electron/blob/v44.2.0/README.md#platform-support)
requires macOS 13 or newer, or Windows 10 or newer. Native provider prerequisites
and the tested OS matrix belong in each release's validation record; an Electron
platform binary alone does not prove every provider on every supported OS release.

## Prerequisites

Use the Node version in `.node-version`, Bun `1.4.2`, and `just`. Windows builds
also need Git Bash's `sh` on PATH. Enable `git config --global core.longpaths true`
before checkout on Windows. `just install --frozen-lockfile` builds the pinned
public Tea submodule before installing workspaces.

Signed Mac releases require full Xcode, Longsurf's **Developer ID Application**
certificate and private key, and the `openchart-notary` Keychain profile. Keep
`ai.longsurf.openchart` and the signing team stable. Configure a new profile with
`xcrun notarytool store-credentials openchart-notary`; never commit credentials.

Signed Windows releases require either `OPENCHART_WINDOWS_SIGN_HOOK` naming an
absolute operator-owned signing module, or `WINDOWS_CERTIFICATE_FILE` naming an
absolute certificate path with `WINDOWS_CERTIFICATE_PASSWORD` supplied securely.
The hook follows `@electron/windows-sign`'s `hookModulePath` contract. Signing
configuration is shared by Electron Packager and Squirrel. Keep credentials and
hooks outside the repository. The Squirrel package ID `OpenChart` is permanent.
The checked-in CI lane builds unsigned installers without signing credentials.

The checked-in `app/.env.production` supplies the public Clerk live key. The build
environment or `app/.env.production.local` can override it. Google OAuth secrets
stay in Clerk; see [Clerk configuration](../architecture/desktop.md#clerk-configuration).
Production packaging requires a `pk_live_` key, including unsigned Windows builds.

Publication requires Cloudflare access to the `openchart-releases` R2 bucket
(`npx --yes wrangler@4.135.0 login`) and `gh` authenticated for
`longsurf-ai/openchart`. These credentials are needed only by the operator, not
by packaging CI. The download domain is `downloads.longsurf.ai`.

## 1. Prepare the source and build

Increment `platform/desktop/package.json` to a new `x.y.z` version and add its
entry to `platform/desktop/src/changelog/changelog.json` following
[its AGENTS.md](../../platform/desktop/src/changelog/AGENTS.md). Commit the source
and run `just check`. Release builds reject changes to tracked files. Build every
target for that version from the same commit; never reuse a published version for
different bytes.

On the signing Mac:

```sh
just install --frozen-lockfile
just check
just desktop-release darwin-arm64
just desktop-release darwin-x64
```

The default `just desktop-release` retains `darwin-arm64`. Mac builds sign,
notarize and staple the app and DMG, verify their signatures and Gatekeeper
acceptance, and inspect each Mach-O file for the target architecture. They never
upload releases.

On Windows, using Git Bash:

```sh
just install --frozen-lockfile
just desktop-release win32-x64 unsigned
```

This produces a real test installer and update package. The build receipt records
`unsigned`; the app has no automatic update feed, and the public publisher refuses
it. Once signing is configured, use `just desktop-release win32-x64 signed` from a
clean source revision with a fresh version. Signing must happen during packaging,
before Squirrel embeds the app in the update package.

The **Desktop Windows** workflow runs the unsigned build, selected native-owner
tests, and the relocated packaged smoke on `windows-latest`. It uploads the release
directory as `OpenChart-win32-x64-unsigned-<commit>` and smoke evidence separately.
The **Desktop Intel Mac** workflow packages and runs the development smoke on
`macos-15-intel`. Both use read-only repository tokens and no production secrets.
A failed smoke can still leave a downloadable artifact; record the job conclusion
alongside the artifact rather than treating upload success as test success.

Retrieve a known Windows run by its run ID and exact source commit:

```sh
gh run view <run-id> --repo longsurf-ai/openchart
gh run download <run-id> --repo longsurf-ai/openchart --name OpenChart-win32-x64-unsigned-<commit> --dir platform/desktop/out/release/<version>/win32-x64
```

Retain the Actions run URL and upload-artifact digest with the release evidence.
`BUILD.json` records the builder/run and hashes the individual files; the enclosing
Actions artifact digest is available only after upload and is recorded separately.

Each finished target directory is `platform/desktop/out/release/<version>/<target>/`:

| File                                      | Purpose                                                        |
| ----------------------------------------- | -------------------------------------------------------------- |
| `OpenChart-<version>-darwin-<arch>.dmg`   | Signed, notarized Mac installer                                |
| `OpenChart-<version>-darwin-<arch>.zip`   | Signed, stapled Mac update                                     |
| `OpenChart-<version>-win32-x64-setup.exe` | Windows installer                                              |
| `OpenChart-<version>-full.nupkg`          | Squirrel Windows update package; retain its filename           |
| `RELEASES.json` / `RELEASES`              | Target's Mac / Windows update manifest                         |
| `SHA256SUMS`                              | Checksums for downloads and feed manifest                      |
| `SOURCE`                                  | Full source commit                                             |
| `BUILD.json`                              | Target, source, signing, builder, toolchain and file inventory |

Only platform-appropriate downloads appear in each directory. The directory is
exposed after verification succeeds and is never overwritten. Retain it exactly;
rebuilding signed artifacts produces different bytes.

## 2. Verify the packaged app

The production bundle is under `platform/desktop/out/<version>/OpenChart-<target>/`.
On the signing Mac, run native Apple Silicon smoke with real Keychain access:

```sh
just desktop-smoke "$PWD/platform/desktop/out/<version>/OpenChart-darwin-arm64/OpenChart.app/Contents/MacOS/OpenChart" production system
```

On Windows, supply an absolute Windows path to the packaged executable:

```sh
just desktop-smoke 'C:\checkout\platform\desktop\out\<version>\OpenChart-win32-x64\OpenChart.exe' production
```

The smoke relocates the whole app, uses an isolated temporary profile, and verifies
backend startup/shutdown, persistence, settings, model fixture requests, workflows
and renderer isolation. Windows fixtures are real Node SEA executables. Mac Intel
CI executes on an x64 runner; an optional local Rosetta run is emulation and should
be recorded as such. Smoke results and screenshots live under
`platform/desktop/.artifacts`.

Automated smoke uses fake model accounts. Live Google/Clerk sign-in, real provider
credentials, notifications and actual upgrades remain separate acceptance checks.
On Mac, install the DMG into Applications without a Gatekeeper bypass and test
new-user registration, returning-user login, browser callback, Profile and
credential reuse after restart. Keep only the intended production app running
during OAuth.

For Windows device acceptance, retain the artifact version, source commit and
hashes, and check:

- Install and launch; an unsigned test build may show SmartScreen.
- Browser account sign-in/callback and encrypted credentials after restart.
- Charts, data feeds, Tea and workspace workflows.
- Codex, Claude and Antigravity discovery, login, tool calls and cancellation.
- No unexpected console windows; paths with spaces and Unicode work.
- Notifications and Action Center activation, and normal Quit cleanup.
- Uninstall removes shortcuts and the `openchart:` handler. Data is intentionally
  retained in `%APPDATA%\OpenChart` and `%USERPROFILE%\.openchart`.
- Upgrade from one test version to a later version preserves settings, workspace
  and credentials. A build alone does not establish this outcome.

## 3. Validate and publish an explicit target set

Validate signed local artifacts without network requests or writes:

```sh
just desktop-publish <version> darwin-arm64 darwin-x64 --dry-run
```

Omitting targets requires all three. Explicit subsets allow Mac publication while
Windows signing is being configured. Every selected target must have matching
SOURCE/receipt commits, correct checksums and a feed referencing its own target
and version. Windows `RELEASES` is additionally verified against each package's
SHA-1 and size. Unsigned receipts are rejected even in public-channel dry runs.

After platform acceptance, the same command without `--dry-run` publishes:

```sh
just desktop-publish <version> darwin-arm64 darwin-x64
```

The publisher performs these operations:

1. Check every remote immutable object and existing GitHub asset. Identical bytes
   can be reused; conflicts abort before any write. An existing GitHub tag must
   resolve to the recorded source commit.
2. Upload missing versioned downloads and target metadata, then download and hash
   them to verify each upload.
3. Update stable download pointers for all selected targets, verifying each.
4. Write and verify the feeds after all downloads and pointers are ready.
5. Create or reuse the source-matched GitHub release, add missing assets, verify
   their digests, then publish/mark it Latest. Target-qualified `SHA256SUMS`,
   `SOURCE` and `BUILD.json` assets allow later target additions without replacing
   another target's inventory or the historical unqualified `SHA256SUMS` asset.

Remote directories under `https://downloads.longsurf.ai/openchart/` are:

| Target directory | Stable download      | Feed            |
| ---------------- | -------------------- | --------------- |
| `darwin/arm64`   | `OpenChart.dmg`      | `RELEASES.json` |
| `darwin/x64`     | `OpenChart.dmg`      | `RELEASES.json` |
| `win32/x64`      | `OpenChartSetup.exe` | `RELEASES`      |

Apple Silicon URLs remain unchanged. Versioned artifacts and metadata use immutable
caching; stable pointers and feeds use `no-store`. Squirrel package names are never
changed. GitHub hosts all selected downloads in one release with target-qualified
metadata; feed manifests remain on R2.

## 4. Verify a real update and download links

Signed production apps derive the feed from their own platform and architecture,
check at startup and hourly, and expose downloaded updates through the sidebar
button. Windows skips updater initialization on Squirrel's first run. Mac installs
the update at quit; Windows prepares the new version during download and launches
it on restart. Development and unsigned packages never check automatically.

Start the previous signed release, download its update and test the sidebar
restart. Unsaved-editor cancellation must keep the app open; proceeding must wait
for backend exit. Verify the new version, saved settings/workspace, credentials,
account identity and Changelog. On Mac, quit every other production copy before
installation. Custom isolation flags are not retained by native updater relaunch;
record manual relaunch with those flags separately from a normal installed update.

Unsigned Windows test builds can exercise Squirrel installation mechanics with
`Update.exe --update <folder>` against a folder containing `RELEASES` and its
`.nupkg`. That does not test the in-app HTTPS feed or signed-update trust. The
public publisher does not upload unsigned builds, and no test feed is provisioned
by these commands.

Verify each published stable pointer, manifest and checksum URL, and inspect
`gh release view v<version> --repo longsurf-ai/openchart`. The separately owned
website needs explicit Apple Silicon, Intel Mac and Windows download choices.
Enable a link only after its target is published; do not infer Mac architecture
from the browser. Website deployment is a separate operation in its owning repo.

## Failure and recovery

- Packaging, notarization, signature or architecture verification failure: do not
  publish. On Mac inspect `xcrun notarytool log <id> --keychain-profile openchart-notary`.
- Existing release directory: retain it and reuse its verified artifacts, or use a
  new version. Never delete a completed directory merely to rebuild a retry.
- Partial upload: rerun with the exact same files. Immutable matches are skipped,
  missing GitHub assets are added, and an existing draft is completed. A differing
  object or asset is an error and is never silently replaced.
- Bad public release: restoring an older verified target inventory changes its
  feed/pointer and GitHub Latest but cannot revoke a download or downgrade an
  installed app. Ship a fix with a higher version. Older release directories
  without BUILD.json are not accepted by this publisher; do not fabricate signing
  evidence to bypass the check.
- A Mac update failure can be diagnosed with
  `~/Library/Caches/ai.longsurf.openchart.ShipIt/ShipIt_stderr.log`. Preserve build,
  signing, CI and real-device outcomes with the release evidence.
