# PR #99 Native Acceptance Diagnosis

## Scope and outcome

This report closes the diagnostic-only pass for draft PR
[#99](https://github.com/DaveHomeAssist/prompt-lab/pull/99). It does not
change download behavior, XDG configuration, filenames, timeouts, or the
completed-file assertion.

- Diagnostic commit: `5ba88d8ce79ec0bbc6a5ef8b1f53bb7dec1e3fae`
- Tested pull-request merge SHA: `229479c229dae7449585590cfd5238627bb9602f`
- Desktop Build run:
  [34099816603](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/34099816603)
- Terminal result: failure on attempt 1; the run was not retried
- Passing jobs: extension tests, Windows desktop build/acceptance, and macOS
  universal packaging
- Failing job: Ubuntu desktop build/acceptance, only at `Install and exercise
  Linux DEB`
- Skipped job: alternate-package acceptance, because its Ubuntu dependency
  failed

## Local validation

Node 22 syntax checks passed for all three modified acceptance scripts.

```text
./node_modules/.bin/playwright test e2e/native-acceptance-development.spec.js --workers=1
3 passed (16.6s)
```

The exact browser acceptance command passed at 400px, 480px, and 1180px. The
existing completed-file assertion remained intact.

## Completed workspace export evidence

### Linux failure

The Linux native exercise reached the export checkpoint and then failed with:

```text
Timed out: workspace export file completed in /home/runner
```

The diagnostic record established all of the following before that timeout:

- `xdg-user-dir DOWNLOAD` exited 0 and returned `/home/runner`.
- `XDG_CONFIG_HOME` resolved to `/home/runner/.config`.
- `/home/runner/.config/user-dirs.dirs` did not exist (`ENOENT`).
- `/home/runner` existed, but its before/after filename listings were identical
  and contained no workspace export JSON.
- `/home/runner/Downloads` did not exist before or after the action.
- The application created an `application/json` blob URL and supplied the
  expected anchor filename, `prompt-lab-workspace-2026-09-07.json`.
- The visible application toast reported that 21 prompts, 6 runs, 1 test case,
  and Scratch data were exported.
- No visible download, file chooser, or error dialog appeared. The only visible
  dialog was the application's Settings dialog.
- The Linux driver log contained AT-SPI D-Bus warnings but no download,
  destination, portal, or permission error.

This proves that the file was absent from the two searched locations. It does
not prove that no download was attempted or that no file was written anywhere
else.

The freedesktop.org XDG user-directory specification documents `$HOME` as the
fallback when the download-directory configuration is absent, which matches the
observed command result:
[xdg-user-dirs](https://wiki.freedesktop.org/www/Software/xdg-user-dirs/).
WebKitGTK documents that an unhandled download destination defaults to the
system download directory with the suggested filename:
[WebKitDownload::decide-destination](https://www.webkitgtk.org/reference/webkit2gtk/stable/signal.Download.decide-destination.html).

### Windows control

The corresponding Windows native exercise passed the same completed-file
checkpoint:

- Completed file:
  `C:\Users\runneradmin\Downloads\prompt-lab-workspace-2026-09-07.json`
- Size: 76,838 bytes
- SHA-256: `cf3313e31412ee8dccfb0716166383ef84f8f77a1c474518195dd4952970ce9`
- Full parsed JSON equality: passed
- Anchor filename and `blob:` URL scheme: matched Linux
- Visible export-success toast: present
- Visible download/error dialog: absent

This control makes export serialization, the filename, and the browser-side
anchor action unlikely causes of the Linux failure.

## Settings-button appearance evidence

| Platform/theme | `appearance` | `-webkit-appearance` | Background | Screenshot assessment |
| --- | --- | --- | --- | --- |
| Linux light | `none` | `none` | `rgba(242, 245, 249, 0.467)` | Readable; no native bevel or image |
| Linux dark | `none` | `none` | `rgba(241, 245, 249, 0.62)` | Readable and aligned, but computed background differs from the declared dark class and Windows control |
| Windows light | `none` | `none` | `rgb(241, 245, 249)` | Readable and consistent with adjacent controls |
| Windows dark | `none` | `none` | `rgba(255, 255, 255, 0.04)` | Readable and consistent with adjacent controls |

The inspected light/dark screenshots do not reproduce a visibly broken native
Settings button at the 1180x900 acceptance viewport. Computed appearance alone
would not establish that result; the screenshots are the user-facing evidence.
The Linux dark computed-background discrepancy remains unexplained and should
not be represented as cross-platform style parity.

## Cause assessment

1. **Confirmed environment fact, high confidence.** The Linux runner had no
   `user-dirs.dirs`, and its download directory resolved to `/home/runner`.
2. **Likely failure boundary, medium confidence.** Linux WebKitGTK did not leave
   a completed file in the resolved system download directory even though the
   page supplied a valid JSON blob and expected filename. The available
   evidence places the unresolved behavior in the Linux native download
   lifecycle or CI desktop fixture, after browser-side export generation.
3. **Not supported as causes.** Export serialization, the suggested filename,
   and the JavaScript anchor action are contradicted by the Windows control and
   Linux telemetry.
4. **Unknown.** The run did not trace WebKitGTK download signals or the final
   native destination. Therefore it cannot distinguish a download that never
   started from one redirected, cancelled, or failed outside the two searched
   locations.

## Separate repair recommendation

No product-code change is justified by this diagnostic alone. In a separately
authorized changed-candidate run, first make the Linux CI fixture own a
disposable XDG Downloads directory and configure it before the native app
launch. If completion still fails, add native WebKitGTK/Tauri download-lifecycle
telemetry that records the proposed destination and terminal error, then decide
whether explicit product-side destination handling is required.

Neither repair was implemented here because this pass was explicitly limited
to diagnostics and an unchanged-failure run was not authorized for retry.

## Artifact inventory

- Linux native acceptance artifact: `native-acceptance-results-linux`, artifact
  ID `10010393319`
- Windows native acceptance artifact: `native-acceptance-results-windows`,
  artifact ID `10010369497`
- Both artifacts contain `exercise.json`, driver logs, and the light, dark,
  export-result, and failure/result screenshots used for this assessment.
