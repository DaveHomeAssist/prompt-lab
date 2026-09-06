# Desktop acceptance checklist

## Scope and current gaps

This is the executable handoff for implementation-plan issue I and the native desktop portion of J. Packaging and browser frontend checks do not close installation or operator acceptance. Run this checklist only in disposable accounts or VMs with synthetic data. No paid-provider call, public release, signing operation, personal-data deletion, or user's application uninstall is part of this checklist.

The product candidate is main merge `a12b7e6fe85ff23219606e5167a5eed35b548ea5` (PR #88), containing phases 2–8. Refresh main and CI before choosing final artifacts. Later commits changing only this checklist or its operator fixture do not change the packaged application; record that distinction explicitly. Source packages declare 1.7.1; this does not create a public 1.7.1 release. Follow [release versioning](release-versioning.md) for a separately authorized release.

As of preparation, disposable macOS/Windows/Linux hosts and operators are unassigned; actual clean install, visible native launch, restart, upgrade, rollback and uninstall remain Unknown. Local signing discovery found two valid identities, but candidate signatures and notarization remain unverified. The Computer Use service failed with error -10005, “codex app-server exited before returning a response.” Signed-in canonical web acceptance remains Unknown independently of local web tests.

## Candidate and artifact evidence

Use GitHub's `Desktop Build` workflow in `.github/workflows/desktop-build.yml`. Its matrix is macOS universal (arm64 and x86_64), Windows runner default architecture, and Ubuntu 22.04 runner default architecture. Record the actual runner and binary architecture; a runner label alone is not architecture proof. macOS minimum 10.15 is declared configuration, not proof on that OS version.

From the repository root:

```sh
git fetch origin main
git rev-parse origin/main
gh run list --repo DaveHomeAssist/prompt-lab --workflow desktop-build.yml --branch main --limit 10 --json databaseId,headSha,status,conclusion,url
```

Choose the successful run whose headSha equals the candidate. Record its ID as RUN_ID; do not select the newest unrelated green run. Then:

```sh
gh run view RUN_ID --repo DaveHomeAssist/prompt-lab --json headSha,conclusion,jobs,url
gh api repos/DaveHomeAssist/prompt-lab/actions/runs/RUN_ID/artifacts --jq '.artifacts[] | {id,name,size_in_bytes,digest,expired}'
gh run download RUN_ID --repo DaveHomeAssist/prompt-lab --name prompt-lab-macos-latest --dir candidate-macos
```

Repeat with `prompt-lab-windows-latest` or `prompt-lab-ubuntu-22.04` on its matching host. Substitute the recorded numeric run ID for RUN_ID. Download one platform at a time when disk space is limited. Retain the workflow archive digest separately from hashes of extracted installers: they hash different objects.

- macOS: run `shasum -a 256` on each DMG, mount it read-only with `hdiutil attach -readonly <exact-dmg-path>`, then inspect the contained app using `codesign --verify --deep --strict --verbose=2`, `codesign -dv --verbose=4`, and `spctl --assess --type execute --verbose=4`. Use `lipo -archs <app>/Contents/MacOS/<executable>` and inspect `Contents/Info.plist` for version/identifier. Record exit codes. Unmount with `hdiutil detach <recorded-mount-point>` after inspection. Do not disable Gatekeeper or alter quarantine to manufacture acceptance.
- Windows: use `Get-FileHash -Algorithm SHA256 -LiteralPath <installer>` and `Get-AuthenticodeSignature -LiteralPath <installer>`. Record MSI and NSIS separately, including signer status and OS/build/architecture. Use each installer on a separate restored VM snapshot.
- Linux: use `sha256sum <package>`, `file <AppImage>`, and `dpkg-deb --info <deb>`. Record dependencies and architecture. Test the DEB and AppImage separately on matching clean snapshots.
- If a signature is absent, invalid, or rejected by the OS, record the result and keep distribution acceptance open. Certificate availability does not prove the artifact was signed. Public distribution or signing changes require their own authorized release workflow.

## Local provider fixture

The operator fixture uses the existing deterministic enhancement contract and exposes only Ollama-compatible `/api/tags` and `/api/chat`. It binds 127.0.0.1:11434, never forwards requests, never reads keys, limits input to 256 KiB, and logs event names only. Its CORS allowlist covers the Tauri application origins. It is not a hosted-web provider or an SSE simulator.

Use Node 22. From `prompt-lab-source/`:

```sh
node --test scripts/desktop-fixture-server.test.mjs
node scripts/desktop-fixture-server.mjs success
```

If port 11434 is occupied, stop and use a disposable host with a free port; do not terminate an existing Ollama service. In the packaged app's Provider Settings, select Ollama, set the custom URL to `http://127.0.0.1:11434`, refresh models, and choose `promptlab-fixture`. Keep external providers unconfigured. A model-list failure is a failed native networking check, not permission to change CSP or bypass security controls.

Stop the owned fixture with Ctrl-C, then restart it with `slow` for a 30-second response delay or `error` for a terminal HTTP 400. In slow mode, Cancel should produce `fixture: connection-closed` without `fixture: completed`. The fixture test proves server behavior; only the packaged UI can prove native transport cancellation.

## Per-platform operator procedure

The `Desktop Build` workflow also runs an installed-binary smoke on disposable Windows and Linux runners. It installs the freshly built MSI/DEB, uses Linux's native WebDriver through `tauri-driver` and Windows Edge WebDriver attached to the directly launched app, captures Tauri-window screenshots, exercises fixture Enhance/Save/Scratch/quit/relaunch/Cancel/error, then uninstalls and reinstalls to check retained data. `native-acceptance-<runner>` artifacts contain the observed results and installer hashes. A failing native job is not installer acceptance. This initial automation does not prove previous-version upgrades, NSIS/AppImage lifecycle, macOS acceptance, or every Library/follow-up scenario.

The Linux test-only driver is pinned to the CI-verified `tauri-driver 2.0.6` from the official Cargo registry with its lockfile; the documented Windows matching-driver installer is pinned to commit `8c4b34f51b45f5cf08013366d703de464ab871d1`. No runtime dependency or application security policy changes are needed. Platform support follows [Tauri's native WebDriver setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/) and [CI guide](https://v2.tauri.app/develop/tests/webdriver/ci/). The standard driver does not cover macOS; no paid driver service is introduced.

Windows automation follows Microsoft's [attach-to-running-WebView2 flow](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver#step-4b-attaching-microsoft-edge-webdriver-to-a-running-webview2-app). Only the owned test process receives the loopback debugging-port environment option; runtime security policy and registry settings remain intact. The app uses its default `%LOCALAPPDATA%/<Tauri identifier>` profile, and the harness closes its native window and waits for process exit between sessions. This keeps restart and reinstall checks on the same disposable app data. Record the profile path in the evidence artifact.

WebView2 150 and later intentionally ignore these environment overrides for elevated hosts. The Windows installer step remains privileged, but `tests/windows-native-standard-user.ps1` removes administrator rights and lowers the test process to medium integrity before launching the harness. It verifies the actual child token before resuming execution and writes `<phase>-privileges.json`. This follows Microsoft's [standard-user hosting recommendation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security#recommended-privilege-level-for-webview2-host-applications). It does not modify registry policy, disable OS protections, downgrade WebView2, or add debugging options to the shipped application.

Record PASS, FAIL or Unknown for every step, with a screenshot or exported synthetic fixture and observed result. Never substitute a browser preview for the native window.

1. Restore a clean VM snapshot or sign into the designated disposable account. Record OS, architecture, candidate SHA, installer name/hash, operator, and date. Confirm there is no personal Prompt Lab data or configured paid-provider key in this profile.
2. Install the matching package using its normal OS workflow. Record warnings and signature results. Launch it and capture the visible app window and version. Navigate Create, Library, Compose, Evaluate and Scratch. Resize to narrow and wide layouts; test zoom in/out/reset with the documented platform shortcuts.
3. Start the success fixture. Write “Summarize this synthetic acceptance note” in Create, Enhance, and verify a deterministic enhanced prompt appears. Save it as `Desktop acceptance parent`; open it from Library. Record one successful attempt in history. Create a Scratch note `Desktop acceptance note` containing `Survives restart`.
4. Save a second prompt with a distinct title, assign both to a test collection, select that collection, and delete it. Verify both prompts remain, their collection assignments clear, and All prompts becomes active. Search matching words across title/metadata from Library and Composer; verify the same matching entry. Test filtered manual Up/Down ordering and import a starter pack; Newest should place its newly loaded prompts first.
5. Export the disposable workspace and record a hash. Quit the app fully, launch again, and verify both Library prompts, order, Scratch content, history and local provider settings. Export again and compare identities/associations, ignoring legitimate export timestamps. Do not accept an in-memory reload as quit/relaunch proof.
6. Open the exported workspace through raw Library import. Inspect the preview, then Cancel; verify no new entries. Retry and exercise explicit Keep both/Replace/Skip with synthetic conflicts. Verify the selected survivor's runs and versions remain associated after restart. Include a schema-2 fixture with `packs: []`; pre-existing authored packs must survive. Follow the [Library compatibility contract](LIBRARY_COMPATIBILITY_CONTRACT.md) for partial-write limitations.
7. Restart the fixture in slow mode. Start Enhance and cancel after its request event. Verify the server reports connection closure, no late successful output appears, and history remains canceled. Repeat while switching the editor to another prompt; late output must not overwrite the new editor or its Library source. Repeat in Evaluate/Arena when available.
8. Restart the fixture in error mode. Run once; verify a visible failure and failed history, with no successful partial response. With synthetic sensitive text such as `alex@example.test`, start each applicable alternate mode; cancel its preflight and confirm the fixture received no request. Repeat with approved redaction and verify the sent fixture payload through a debugger only on synthetic data, without logging real inputs.
9. Use a saved successful output as the labeled follow-up source where available. For follow-up-specific JSON, use the maintained intercepted browser scenario rather than interpreting this enhancement-only fixture as a suggestion provider. On native desktop, record this item Unknown unless a deterministic suggestion response was provided and actual independent save, parent preservation, source viewing and reload were observed.
10. Record storage-failure injection separately. The maintained packaged Chromium tests cover rejected writes and recovery; actual Tauri quota/fallback behavior needs an instrumented disposable native profile. Do not claim native quota proof from the extension test. Retain any unsaved output and retry without rerunning a provider.

## Upgrade, rollback and uninstall

The currently discovered prior public artifact set is the `v1.5.0-desktop-preview` prerelease, with Windows MSI/NSIS and Linux DEB/AppImage. It is a historical upgrade input, not proof for the candidate. No macOS asset was present in that release; macOS upgrade acceptance remains Unknown until a real supported baseline is identified.

On a fresh disposable snapshot, install the chosen prior artifact, create synthetic Library/Scratch/history/settings state, and export every available portable record. Keep a whole-VM snapshot in addition to exports because old versions may omit newer fields. Record the prior artifact hash and install the candidate through its normal upgrade path. Verify retained data and run the procedure above. Any supported previous version beyond this discovered release is Unknown until canonical release evidence identifies it.

Rollback procedure: restore the pre-upgrade VM snapshot, including its old application and data, then verify the synthetic records. Do not open a migrated current profile in an older binary and call that a supported downgrade. Explicit portable export/import is the recovery fallback only for fields the target version supports.

Uninstall the candidate through its normal OS mechanism on the disposable snapshot. Observe retained data before reinstalling; never manually remove application data during the retention test. Reinstall and record which records return. This checklist makes no cross-platform retention promise: document actual installer behavior and obtain a product decision before declaring a retention policy. Dispose of the test VM only after evidence is retained and under its owner's normal cleanup procedure.

## Evidence handoff and closure

For each target, attach: exact SHA/run/artifact/hash; OS and binary architecture; install/signature result; visible launch; success/cancel/error/preflight; save/restart; import associations; follow-up; upgrade; snapshot rollback; uninstall retention; gaps; next action; operator. Keep installer proof, native iPhone/iPad CI, local browser tests, canonical signed-in web acceptance, and public distribution as separate records.

Append the results to the existing implementation RUN and issues I/J, then read the pages back. I stays In progress while any required platform lifecycle or signing gate is Unknown. J stays In progress while its native desktop behavior lacks proof. Public release and overall production readiness remain outside this checklist's completion claim.
