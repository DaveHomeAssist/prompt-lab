# Save consistency repair

Dave authorized the save shortcut, draft autosave wording and stale tab repair
on October 28, 2026. The observed failures were an unchanged Library output
after saving edited Dual Pane text and a stale Favorite write replacing a newer
saved body.

The scoped outcome is consistent Dual Pane saving, explicit Draft saved
feedback and rejection of writes based on an outdated Library snapshot. A
conflict loads the latest Library state, warns the user and preserves the editor
draft. The user can reload the prompt, retry a Library action, or save the draft
as a separate prompt. A loaded editor retains its expected version across
session restoration. Legacy sessions without version provenance must reload
the prompt or save a separate copy before updating an existing prompt.

Acceptance uses disposable fixtures: both save modifiers, the command palette,
new and existing prompts, reload persistence, a stale Favorite with delayed
storage events, an editor whose Library has already received a newer version,
and an unrelated prompt created by another tab. Existing deletion markers,
durable save acknowledgement, quota failure feedback, import protections and
reset/undo behavior must remain intact.

This repair does not introduce account synchronization, a storage migration,
new dependencies or a database transaction protocol. Snapshot checks reject
observably stale localStorage writes; they are not an atomic cross-process
compare-and-swap primitive. Truly simultaneous read/write interleaving remains
a separate storage architecture limitation.
