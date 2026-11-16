# Inline prompt rename

Library users should be able to rename a saved prompt while browsing, without opening or saving the entire Details form. Double-click the card title or inspector heading, press F2 on a focused card, or use Rename prompt in the inspector. Select the existing title on entry. Enter or blur saves a trimmed, changed, nonempty title; Escape cancels.

Use the existing acknowledged Library update and change only the title and modification timestamp. Keep other Details edits intact. Restore the saved title and explain any write failure. Trash, native iOS, prompt content, and storage schemas are outside this slice. No additional dependencies are needed.

Verify both entry points, single-click selection, focus and keyboard handling, cancellation, no-op and failed writes, retained Details edits, reload persistence, and narrow and wide Library layouts. The floating inspector must leave enough time for a second click on a card title.
