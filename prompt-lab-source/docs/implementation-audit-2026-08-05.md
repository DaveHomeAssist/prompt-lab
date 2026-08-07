# Product Improvement Implementation Audit - 2026-08-05

## Baseline And Deployment

| Acceptance item | Status | Evidence |
|---|---|---|
| Work starts from current `origin/main` | Passed | Clean worktree branch `work/prompt-lab-product-improvements-2026-08-05` started at `07e2964c3a54e031bb13173ddc2b95833d5697bc`. |
| Existing WIP remains recoverable | Passed | Original `wip/prompt-lab-library-layout-fix-2026-03-23` checkout was not changed. Unique commits are classified in `product-ideas-2026-08-05.md`. |
| Baseline tests and builds | Passed | Node 20 extension, desktop adapter, Vite, and Cargo checks passed before feature work. |
| Duplicate Vercel status removed | Owner approval required | GitHub reports `Vercel - prompt-lab` successful and `Vercel - prompt-lab-main-clean` failed on the same `main` commit. The duplicate owns no custom production domain but remains connected. |
| Production commit maps to GitHub | Passed | Production project `prompt-lab` and freshly fetched `origin/main` were both verified at `07e2964c3a54e031bb13173ddc2b95833d5697bc`. |
| Pages ownership decided | Owner approval required | Pages is built from `main:/docs` with `promptlab.tools` configured, while DNS and live response headers prove Vercel serves the domain. The runbook defines retain-mirror and disable-mirror paths. |
| Node runtime contract | Passed locally; preview check pending | Root package metadata, `.nvmrc`, CI, Pages, desktop, and release workflows now use Node 20. Vercel project metadata reports 22.x, so the effective preview runtime must be confirmed before a project-setting change. |

## Desktop Stabilization

| Acceptance item | Status | Evidence |
|---|---|---|
| One desktop verification command | Passed | `npm run verify:desktop` runs Node checks, 506 tests, desktop smoke tests, two Vite builds, and Cargo check. |
| Reproducible installers | Passed | `npm run package:desktop` produced version 1.7.0 MSI and NSIS installers. |
| Packaged launch and enhancement | Passed | The rebuilt release executable launched with an isolated clean WebView2 profile, connected to Ollama through the settings UI, completed a Balanced enhancement, and exposed no browser-console errors. |
| Provider and storage failures are actionable | Passed | Provider errors distinguish authentication, network, rate-limit, and missing-model conditions. Storage is probed and quota/unavailable failures are visible. |
| Settings/library survive restart | Passed | On two packaged-app restarts against the isolated profile, provider/model/context settings rehydrated and the saved E2E library record remained visible in the Library UI at revision 3. |
| Ollama provider request | Passed | The production desktop adapter discovered three local models and completed the real Balanced enhancement contract with `gpt-oss:20b`, bounded to a 4096-token context. The packaged settings connection also passed. |
| Remote provider request | Manual gate | No Anthropic, OpenAI, Gemini, or OpenRouter test credential is available in the current environment. |
| Installer install/uninstall | Manual gate | MSI and NSIS artifacts were generated, but installing into a separate Windows user and testing upgrade/uninstall would mutate machine state and was not performed without owner approval. |

Installer outputs:

- `prompt-lab-desktop/src-tauri/target/release/bundle/msi/Prompt Lab_1.7.0_x64_en-US.msi`
- `prompt-lab-desktop/src-tauri/target/release/bundle/nsis/Prompt Lab_1.7.0_x64-setup.exe`

## Enhance And Follow-ups

| Acceptance item | Status | Evidence |
|---|---|---|
| Actual output is preferred | Passed | Suggestions use the selected successful run and send labeled source prompt plus actual output. |
| Source traceability | Passed | Suggestions and saved records retain prompt ID, run ID, provider, model, and generation timestamps. |
| Independent save | Passed | Follow-ups have Use, Chain, Save, and Copy actions. Save creates a normal tagged library record. |
| Source invalidation | Passed | Suggestions clear when enhanced text or selected run output changes. |
| Narrow workflow | Passed | Browser verification at 360x600 found no page-level horizontal overflow after the compact-header correction. |

## Library Reliability

| Acceptance item | Status | Evidence |
|---|---|---|
| Existing records survive migration | Passed | Legacy arrays are backed up and copied unchanged into envelope schema version 1 before normalization. |
| Confirmed imports only | Passed | Format identification, normalization, validation, preview, conflict resolution, commit, and summary happen in order. |
| Conflict controls | Passed | Each conflict and bulk controls support skip, replace, keep both, and cancel. |
| Stale-tab protection | Passed | Expected revisions reject stale writes; storage subscriptions apply newer clean revisions and flag dirty-state conflicts. |
| Failure and recovery visibility | Passed | UI displays local-only, saving, saved, conflict, or failed state and exposes backup recovery. |
| Export round trip | Passed | Frozen fixture retains metadata, versions, and collections through export/import. |
| Cloud sync | Intentionally gated | The repository contract is ready for another implementation, but auth, backend, tombstones, device IDs, and server conflict policy require a separate product decision. |

## Scratchpads

| Acceptance item | Status | Evidence |
|---|---|---|
| Version-2 migration without text loss | Passed | Version-2 payload is backed up before conversion; plain-text projections match the source exactly. |
| Inline double-click rename | Passed | Enter and blur commit, Escape cancels, and an empty value keeps the previous name. |
| Requested formatting survives reload | Passed | H1, H2, normal, bold, italics, underline, bullet, numbered, task lists, and approved colors use canonical Tiptap JSON. |
| Reliable autosave | Passed | Pending changes flush on debounce, pad switch, editor/window blur, visibility loss, unload, and close; failures remain visible and pending. |
| Portable export | Passed | Plain text and formatted HTML are available. Library promotion uses plain text. |
| Keyboard and narrow layout | Passed | Tiptap provides standard formatting shortcuts; toolbar/navigation tests pass and live 360x600 plus 480x800 checks are usable. |

## Verification Summary

| Check | Result |
|---|---|
| Extension tests | 57 files, 506 tests passed |
| Desktop adapter tests | 3 passed |
| Extension production build | Passed |
| Desktop production build | Passed with extension dependencies physically isolated |
| Cargo check and release build | Passed |
| MSI and NSIS packaging | Passed |
| Packaged executable E2E | Passed: clean app-data launch, settings connection, enhancement, library save, two restarts, and UI rehydration |
| Browser checks | 360x600, 480x800, and wide layouts passed; no overlay, console errors, blank screen, or horizontal page overflow |
| `git diff --check` | Passed |

Known residual risks:

- Vite still reports the pre-existing main bundle above 500 KB. Scratchpads are now a separate lazy-loaded chunk.
- `npm audit --omit=dev` reports the React Router RSC-mode CSRF advisory. Prompt Lab is a client-only Vite application and does not use React Router RSC actions; 7.18.2 is the latest available same-major package at audit time.
- Separate-user installer upgrade/uninstall and a credentialed remote-provider request remain release-operator checks.
- The live Ollama check is repeatable with `npm run test:ollama`; remote-provider verification still requires an approved test credential.
