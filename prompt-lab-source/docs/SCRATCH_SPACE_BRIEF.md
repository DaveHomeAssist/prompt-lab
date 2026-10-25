# Active Scratch note space

Dave's October 23 request: make the active Scratch pad use more of the available screen.

## Smallest useful slice

Stretch the Scratch panel and its Write/Split editor through the height assigned by the app shell. Add a visible Focus note toggle in the note header. Focus hides the note index, outline, formatting/metadata toolbar and secondary footer actions; the note title, save status, retry control and Exit focus stay visible. A Notes action returns to note selection. Exiting restores the existing tools and chosen Write/Split/Preview view.

This uses the existing Scratch editing, selection, autosave, failure/retry, switching and export/send paths. Focus is temporary UI state; no storage schema, provider, billing, migration, native iOS or persistence change. App navigation and the global New Prompt stay available. Other October 23 items remain backlog only.

## Acceptance

- The editor fills its assigned pane in Write and Split; ordinary desktop space is no longer left unused below the editor.
- Focus increases usable editing area, retains note identity and visible save/error/retry status, and provides a reachable Exit focus and Notes action.
- Edits survive focus changes, note switching and reload through existing saving. Existing quota/read-error behavior remains covered.
- Both themes fit desktop, phone, tablet, short landscape, 320×256 stress and 3840×1080 ultrawide without document overflow. Focus keeps the editor reachable at short heights; long notes scroll inside the editor/preview.
- Regression tests, shared builds, CI and deployed browser behavior pass. Physical keyboard/browser chrome and broad native signing/upgrade/human acceptance remain separate.

## Risks and decisions

The existing contained-shell flex chain and mobile minimum-height rule need correction; hiding controls must not leave invisible focus targets. Native HTML hiding is used for tools in focus. Default workspace keeps the index/tools; focus is explicitly selected and resets on workspace remount. No unresolved product decision blocks this bounded slice.

## Release receipt

Closeout verified 2026-10-25. [PR205](https://github.com/DaveHomeAssist/prompt-lab/pull/205) merged as `33016c7fa2427352870635bdfaaa49cc089c59d6`; [PR209](https://github.com/DaveHomeAssist/prompt-lab/pull/209) applied four plain-punctuation status strings as `faea576f73182c5860cd204cddb89807532afd37`.

All seven final release workflows passed. [Native39957992574](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39957992574) passed all six jobs, including MSI, NSIS, DEB and AppImage acceptance and macOS universal packaging. The original feature [native39956447538](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39956447538) also finished with all six jobs successful. No additional campaign was launched for closeout. Earlier NSIS renderer attachment and hosted browser-install failures remain in the historical runs; scoped retries passed without assertion bypass.

[Production39958146860](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/39958146860) passed both signed-in 375px and 1440px cases on faea576: focus area, editing/saving, Exit focus and reload. Both disposable sessions were revoked and verified. No model or billing requests. That deployment was READY; current main47b4b12 and its READY production deployment retain byte-identical application source, with later documentation/progress changes only. This parity does not assert a new signed-in runtime test on the later revision.

Dominic passed 25 affected component checks and six viewport scenarios in both themes, including quota failure/retry, keyboard return to Notes, switching/reload, resize and short/ultrawide layouts. The copy-only patch passed 12 affected checks and the same six scenarios. Full hosted verification passed 53 with one credential-dependent skip; final exact-main CI passed afterward.

[Scratch issue](https://app.notion.com/p/402255fc8f448140b0b8f0bfcee2b929) is Done with readback. Broader physical/human, macOS installed interaction/signing, prior-version upgrade/snapshot restore and tagged-release acceptance remain separate project gates. Four other October 23 intake items remain backlog only. Next: retain the bounded release and await Dave's next selection.
