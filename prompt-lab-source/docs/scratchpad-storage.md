# Scratchpad Storage

Scratchpads use schema version 3 in `pl2-pads`.

Each pad stores:

- `doc`: canonical Tiptap JSON.
- `plainText`: portable projection used for copy, text export, search previews, and Prompt Library promotion.
- `editorFormat`: `tiptap-json`.
- `createdAt` and `updatedAt`: ISO timestamps.

On first version-3 load, version-2 data is copied to `pl2-pads-v2-backup` before conversion. Version-2 `content` is converted into paragraph nodes without changing its plain-text projection. Legacy `pl2-pad` keys are removed only after the version-3 payload is written successfully.

Autosave is debounced and flushes on pad switch, editor blur, browser blur, visibility loss, unload, and component close. Failed writes remain visibly failed and keep the in-memory draft pending.

Exports are available as plain text and portable HTML. Prompt Library promotion always uses the plain-text projection, never editor JSON.
