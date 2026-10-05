# macOS desktop release runbook

Release OpenChart for Apple Silicon from a signing Mac. Run commands from the repository root
unless another repository is named. Packaging and publishing are separate,
operator-run steps; merging a PR does not publish an update.

## Prerequisites

- Apple Silicon Mac, Node 24, Bun, `just`, `jq`, and full Xcode selected with
  its command-line tools available.
- Longsurf's **Developer ID Application** certificate **and private key** in the
  signing Mac's Keychain. Keep the production identity `ai.longsurf.openchart`
  and signing team stable across releases.
- Valid notarization credentials in the Keychain profile `openchart-notary`.
  On a new signing Mac, configure them interactively with
  `xcrun notarytool store-credentials openchart-notary`; never commit credentials.
- The checked-in `app/.env.production` supplies the public Clerk live key,
  `VITE_APP_CLERK_PUBLISHABLE_KEY=pk_live_...`; the build environment or
  `app/.env.production.local` can override it. Only the public key belongs in
  the bundle. Google OAuth secrets stay in
  Clerk; see [Clerk configuration](../architecture/desktop.md#clerk-configuration).
- Cloudflare access to the `openchart-releases` R2 bucket, with its HTTPS custom
  domain `downloads.longsurf.ai` active. Authenticate using
  `npx --yes wrangler@4.135.0 login`.

Check the signing environment without exposing credentials:

```sh
node --version
xcode-select -p
security find-identity -v -p codesigning
xcrun notarytool history --keychain-profile openchart-notary
```

## 1. Prepare and package

Choose the source revision, update `platform/desktop/package.json` to a new,
strictly increasing `x.y.z` version, and commit the release source. In the same
commit, add the release's entry to `platform/desktop/src/changelog/changelog.json`
following [its AGENTS.md](../../platform/desktop/src/changelog/AGENTS.md);
`just check` fails without it. Never reuse a published version for different
bytes. Keep the previous release directory for recovery and record the source
commit with the new artifacts.

```sh
just install --frozen-lockfile
just check
git rev-parse HEAD
release_version=$(node -p "require('./platform/desktop/package.json').version")
just desktop-release
```

`desktop-release` builds the renderer and backend, packages and signs the app,
notarizes/staples it, then creates and verifies the downloads. Apple processing
can take time; wait for successful completion before proceeding. This command
does not upload anything to R2.

The finished directory `platform/desktop/out/release/<version>/` contains:

| File                                   | Purpose                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `OpenChart-<version>-darwin-arm64.dmg` | Signed, notarized installer with an Applications shortcut |
| `OpenChart-<version>-darwin-arm64.zip` | Signed, stapled app for the native updater                |
| `SHA256SUMS`                           | Checksums for both downloads                              |
| `RELEASES.json`                        | Version and ZIP URL for Electron's update feed            |

The app itself is at
`platform/desktop/out/<version>/OpenChart-darwin-arm64/OpenChart.app`.
The release directory appears only after verification succeeds. Preserve the
exact completed directory; rebuilding produces different signed bytes.

## 2. Verify before publishing

Run the packaged smoke with real Keychain access:

```sh
release_app="$PWD/platform/desktop/out/$release_version/OpenChart-darwin-arm64/OpenChart.app"
just desktop-smoke "$release_app/Contents/MacOS/OpenChart" production system
```

The smoke relocates the bundle, uses a temporary profile, and exercises backend
startup/shutdown, persistence, settings and renderer isolation. Its model CLI is
a fixture; it does not prove live Google authentication or a real upgrade.
Keep `platform/desktop/.artifacts/smoke-result.json` with release evidence.

On a test Mac or separate macOS account, install from the DMG into Applications
and verify Gatekeeper accepts it without a security bypass. Use real Keychain
storage. Check Google registration through **Sign up** for a new Clerk user,
returning-user sign-in, the browser callback, and Settings → Profile. Choose
**Connect account** if shown. Quit and reopen; identity and saved credentials
must remain usable. Keep only the intended production app running during OAuth.

Do this before exposing the release to existing users. The current setup has one
public stable feed; it has no staged rollout or private update channel.

## 3. Publish the verified artifacts

This command makes the release available to all production clients:

```sh
just desktop-publish "$release_version"
```

The publisher verifies local checksums and the manifest version, then uploads in
this order:

1. Versioned DMG and ZIP, followed by `SHA256SUMS-<version>`; these are immutable,
   cacheable URLs.
2. `OpenChart.dmg`, the stable website download, with `Cache-Control: no-store`.
3. `RELEASES.json` **last**, with `Cache-Control: no-store`; this enables updates.

Confirm the public endpoints:

```sh
release_base=https://downloads.longsurf.ai/openchart/darwin/arm64
curl -fsS "$release_base/RELEASES.json" | jq -e --arg version "$release_version" '.currentRelease == $version'
curl -fsSI "$release_base/OpenChart.dmg"
curl -fsSI "$release_base/OpenChart-$release_version-darwin-arm64.zip"
curl -fsS "$release_base/SHA256SUMS-$release_version"
```

The stable DMG must return 200, `no-store`, and the expected version in
`Content-Disposition`. The ZIP must return 200. Compare the published checksums
with the retained local `SHA256SUMS`.

## 4. Verify the real update and website

Start the previous signed version on the test Mac. Production Apple Silicon
builds check at startup and hourly, download the full ZIP, and use Squirrel.Mac
to verify the app signature and install it. Development never checks for updates.

- Wait for the blue update button beside the account at the bottom of the
  sidebar, then click it. Restart uses normal Quit, allowing unsaved-editor
  cancellation and waiting for the backend to exit. Without a click, the update
  installs on the next normal quit. The previous version runs this step, so
  versions from before the button show a **Restart to update** / **Later** dialog.
- Quit every production test copy and let installation finish before reopening.
  Another running copy can make Squirrel abort installation.
- Confirm the installed version, saved workspace/settings, Google identity and
  credentials, and that Settings → Changelog lists the new release. Do not count
  mock-Keychain smoke as this acceptance test.
- For a test launched with custom `--user-data-dir` / `--openchart-home` flags,
  leave the button, quit, wait for installation, then manually relaunch with the
  same flags. Native updater relaunch does not retain those isolation arguments.
  Record this separately from testing the button on a normal install.

Useful local checks:

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/OpenChart.app/Contents/Info.plist
codesign --verify --deep --strict /Applications/OpenChart.app
xcrun stapler validate /Applications/OpenChart.app
spctl --assess --type execute -vv /Applications/OpenChart.app
```

If installation fails, inspect
`~/Library/Caches/ai.longsurf.openchart.ShipIt/ShipIt_stderr.log`.
Keep the tested versions, source commit, checksums, notarization results and
actual login/update outcomes in the release record.

The separately deployed website
download buttons point at the stable `OpenChart.dmg` URL, so normal app
releases need **no website redeploy**. If website source changes, run from that
repository:

```sh
just check
just landing-deploy
```

That deployment uses the existing AWS Secrets Manager credential and Cloudflare
Pages project `longsurf`. Verify `https://longsurf.ai/` links downloads to the
stable DMG and Sign in to `https://accounts.longsurf.ai/sign-in`.

## Failure and recovery

- **Packaging/notarization fails:** do not publish. Inspect the build output and
  `xcrun notarytool log <submission-id> --keychain-profile openchart-notary`.
  Correct the cause, then rebuild. Never bypass signature or Gatekeeper checks.
- **A release directory already exists:** keep it. Reuse its verified artifacts,
  or choose a new version; the release builder will not replace it.
- **Upload fails partway:** the feed is written last, but the stable DMG may
  already have changed. Rerun `just desktop-publish <version>` with the exact same
  artifacts and verify both endpoints. Do not rebuild that version to retry.
- **A published release is bad:** using the retained, verified previous release
  artifacts, run `just desktop-publish <last-good-version>` from the repository root to restore the feed
  and website download. This cannot revoke an already downloaded update or
  downgrade an installed app. Ship the fix with a version greater than every
  published version. Do not run an older app against newer persisted data unless
  its compatibility has been verified.
