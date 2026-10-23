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
