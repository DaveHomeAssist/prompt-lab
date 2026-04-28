# Codex Spec — Prompt Lab Windows Build

## Goal

Produce a working, runnable Prompt Lab desktop Windows build artifact (`.msi` and `.exe`) for distribution. Verify the build succeeds and the produced installer launches the app on Windows 10/11.

## Context

- Repo (canonical local checkout): `C:\Users\Dave RambleOn\Desktop\01-Projects\code\daveHomeAssist\prompt-lab`
- Desktop app: `prompt-lab-source/prompt-lab-desktop/` (Tauri 2.x + Vite 8 + React 18)
- Rust crate: `prompt-lab-source/prompt-lab-desktop/src-tauri/`, app version `1.7.0`, identifier `com.promptlab.desktop`
- Tauri config has `bundle.targets: "all"` and a Windows section already present (`digestAlgorithm: sha256`).
- Existing CI: `.github/workflows/desktop-build.yml` already has a `windows-latest` matrix job producing `.exe` and `.msi` via `tauri-apps/tauri-action@v0`.
- Existing release pipeline: `.github/workflows/release.yml` (manual `workflow_dispatch` with version + prerelease inputs).
- Current branch: `uxui-bold-hybrid-pass` with uncommitted WIP. **Build target is `main` unless user specifies otherwise.**
- Node version pin: `.nvmrc` = `20`. CI uses `22`. Local should match `.nvmrc`.

## Scope

**Files to touch (only as needed to produce a working build):**

- `prompt-lab-source/prompt-lab-desktop/src-tauri/tauri.conf.json` — only if Windows-specific bundle settings are missing (e.g., NSIS or WiX preferences). Do NOT change app identifier, version, CSP, or window dimensions.
- `prompt-lab-source/prompt-lab-desktop/src-tauri/Cargo.lock` — regenerated if Rust toolchain installs new transitive deps.
- `prompt-lab-source/prompt-lab-desktop/package-lock.json` — regenerated if `npm ci` produces a clean lockfile.

**Files to AVOID:**

- Anything outside `prompt-lab-source/prompt-lab-desktop/` and `src-tauri/`.
- All extension and web app code (`prompt-lab-extension/`, `prompt-lab-web/`).
- All marketing/docs files (`docs/`, README.md, distribution drafts).
- Existing CI workflows (`desktop-build.yml`, `release.yml`) — do not modify; reuse as-is.
- Anything on the user's WIP branch (`uxui-bold-hybrid-pass`).

## Approach (priority order)

Use the first one that works; do not fall through unnecessarily.

1. **Local build on Walter (192.168.1.193, Windows).**
   - `cd prompt-lab-source/prompt-lab-desktop`
   - Confirm Node 20 (`.nvmrc`); install toolchains if missing: Node 20.x, Rust stable (`rustup default stable`), MSVC build tools (Visual Studio 2022 C++ workload), WebView2 runtime.
   - `npm ci`
   - `npm run tauri:build`
   - Output expected at `src-tauri/target/release/bundle/{nsis,msi}/*.{exe,msi}`.

2. **CI fallback — trigger existing `desktop-build.yml` workflow.**
   - Push `main` (or the requested ref). Workflow runs the `windows-latest` job and uploads `prompt-lab-windows-latest` artifact.
   - Download artifact via `gh run download <run-id> --name prompt-lab-windows-latest --dir $OUT_DIR`.

3. **Cut a release (only if user asked for distribution).**
   - `gh workflow run release.yml -f version=$VERSION -f prerelease=true`.
   - Wait for completion: `gh run watch`.
   - Verify the GitHub Release contains the Windows assets.

## Acceptance criteria

- [ ] `npm run tauri:build` (or CI equivalent) exits 0 against `main` (or the user-specified ref).
- [ ] At least one `.msi` AND at least one `.exe` (NSIS) artifact produced under `src-tauri/target/release/bundle/`.
- [ ] Installer file size is non-zero and matches Tauri 2.x typical Windows bundle size (5–25 MB).
- [ ] Manual smoke: installer runs without SmartScreen hard-blocking (warnings on unsigned binaries are acceptable; record the warning text). App launches and shows the Prompt Lab main window.
- [ ] Build log captured to `docs/codex/build-logs/windows-$DATE.log` for the record.
- [ ] No source files modified outside the Scope list above. `git diff main` should touch only lockfiles and (if necessary) `tauri.conf.json` Windows section.

## Rollback

- Working tree changes: `git restore .` in `prompt-lab-source/prompt-lab-desktop/` to revert any lockfile churn.
- If a release was cut and is broken: `gh release delete $VERSION --yes` and `git push --delete origin $VERSION`.
- No filesystem state outside the repo should need rollback (Rust toolchain installs are additive and harmless).

## Non-goals

- **Code-signing certificate.** Producing a signed installer is out of scope unless `$WINDOWS_SIGNING_CERT` is provided as an env variable. Default: unsigned, document the SmartScreen warning.
- **Notarization / Microsoft Store submission.** Out of scope.
- **Auto-updater configuration.** Out of scope.
- **App version bump.** Use `1.7.0` as-is unless user specifies `$VERSION`.
- **CI workflow changes.** Existing `desktop-build.yml` already covers Windows; do not modify it.
- **Cross-compilation from non-Windows.** If Walter is unavailable, use CI; do not attempt to cross-compile from macOS or Linux.
- **Changes to extension or web app.** Out of scope entirely.
- **UX or feature work.** Out of scope.

## Variables (resolved by Dave at execution time)

- `$VERSION` — release tag if cutting a release. Format `v1.7.0`. Otherwise unused.
- `$WINDOWS_SIGNING_CERT` — path to .pfx if signing is requested. Otherwise unused (build is unsigned).
- `$OUT_DIR` — where to copy artifacts after build for Dave to pick up. Default: `prompt-lab/dist/windows/`.
- `$REF` — git ref to build. Default: `main`.

## Reporting

After completion, write a one-page summary to `docs/codex/build-reports/windows-$DATE.md` containing:
- Approach used (local vs CI vs release).
- Build duration.
- Artifact paths + sizes.
- Any warnings encountered (SmartScreen, antivirus, missing optional deps).
- Smoke-test result (launched / failed to launch / installer ran but app crashed).
- One-line verdict: ship-ready / needs follow-up / blocked.
