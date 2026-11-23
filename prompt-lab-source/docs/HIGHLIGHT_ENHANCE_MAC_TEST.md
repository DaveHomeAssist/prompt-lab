# Highlight to enhance — Mac test prompt

Paste the prompt below into Codex on the Mac. It is self-contained.

---

You are testing Prompt Lab's highlight-to-enhance branch on this Mac. Work in the Prompt Lab repo (DaveHomeAssist/prompt-lab). Do not merge, force-push, re-run CI, or submit to the Chrome Web Store. Report pass or fail for every site and app, with a screenshot for each. Do not send real secrets, passwords, or private mail to a provider. Use a short harmless sentence as the selection, and a provider key that is already configured for this machine.

## Checkout and build

1. `git fetch origin cursor/highlight-to-enhance-a594` and check out that branch. Confirm `git status` is clean aside from build output.
2. Use Node 22 (`prompt-lab-source/.nvmrc`). In `prompt-lab-source/prompt-lab-extension` run `npm ci`, then `npm test`, then `npm run build`.
3. In `prompt-lab-source/prompt-lab-desktop` run `npm ci`. Then from `prompt-lab-source/prompt-lab-desktop/src-tauri` run `cargo test --bin prompt-lab-desktop`. Then from the desktop package run `npm run tauri:dev` (leave it running).
4. Chrome: load the unpacked extension from `prompt-lab-source/prompt-lab-extension/dist`. Confirm the extension's Settings page has "Show Enhance with Prompt Lab and Send to Prompt Lab when text is selected" checked. Confirm a provider key is already saved. Do not print the key.

## Extension, in Chrome

For each site, select a short harmless sentence, right-click, and confirm the menu shows "Enhance with Prompt Lab" and "Send to Prompt Lab" only while text is selected. Screenshot the menu.

Then use Enhance with Prompt Lab:

- The accept card appears beside the selection, in both the page's light look and a dark page or dark system appearance if you can switch one site. Screenshot the card both ways.
- The card shows the original and the enhanced text. Enter accepts. Esc cancels and leaves the page text unchanged.
- Accept replaces only the selection. The page's own undo (Command-Z) restores the original selection. Screenshot after Accept and after undo.
- Edit changes the text before Accept. Copy copies the enhanced text.
- If the page cannot be edited in place, the card says "Copied, paste to replace", the clipboard contains the enhanced text, and the page text is unchanged. Paste once to confirm, then undo if the app allows it.

Sites, in this order:

1. ChatGPT composer (contenteditable).
2. Gmail compose body (contenteditable).
3. Google Docs (often a canvas; the fallback path is a pass if the card says "Copied, paste to replace" and the clipboard is correct).
4. Notion page (contenteditable).
5. A plain textarea. Use `prompt-lab-source/prompt-lab-extension/e2e/fixtures/highlight-demo.html` opened as a file or via a local static server.
6. A GitHub comment box (textarea).

Also:

- Send to Prompt Lab opens the side panel on Write with the selection in the editor, not appended to an old draft.
- Settings: uncheck the right-click option, reload a page, and confirm both items are gone. Turn it back on and confirm they return.
- Cancel during "Enhancing…" does not change the page.
- Select text inside a password field if one is handy (a throwaway local form is enough). The extension must refuse and must not send that value.
- Watch the service worker console. It must not log API keys or the full prompt payload.

## Desktop shortcut

The running app registers Option-Command-E (Alt+Command+E). It can be changed or turned off in Provider Settings under "Highlight to enhance".

1. If macOS has not granted Accessibility to Prompt Lab, press the shortcut and confirm the window explains System Settings, Privacy & Security, Accessibility, and that the clipboard was not changed. Screenshot it. Grant access, then continue. The macOS Services menu entry is a follow-up and should not be required for a pass.
2. Copy a distinctive marker such as "CLIPBOARD-MARKER" so the clipboard is known.
3. In TextEdit, Notes, and VS Code, select a short harmless sentence and press Option-Command-E. A small always-on-top window appears near the pointer. Screenshot it.
4. Accept pastes over the selection only. Command-Z undoes that paste. The clipboard is "CLIPBOARD-MARKER" again after Accept, Cancel, and a failed enhance. Check it with `pbpaste` after each of those three.
5. Turn the shortcut off in Settings and confirm Option-Command-E does nothing. Turn it on again. Change it to Option-Command-H, confirm the new shortcut works, then set it back to Alt+Command+E.
6. Dark mode: switch the app theme or the system appearance and screenshot the accept window.

## Automated tests

From `prompt-lab-source/prompt-lab-extension`:

- `npm test`
- `npx playwright test e2e/highlight-enhance.spec.js`

Both must pass. Quote the summary lines.

## Security review of the diff

Review the branch diff against main. Fail the review if any of these are true:

- A page script can read provider keys, chrome.storage, or the service worker. The injected file is `highlight-content.js` in the isolated world, with no keys.
- Selection or model text is assigned with innerHTML, insertAdjacentHTML, or document.write.
- The manifest adds host access broader than the existing provider hosts, or a permanent content_scripts entry, or web_accessible_resources for this feature. `contextMenus` is the only new permission.
- The desktop shortcut sends the previous clipboard contents when the simulated copy fails. A sentinel must be restored and must not be sent to the provider.
- Accept pastes without restoring the clipboard afterwards.
- Password fields are enhanced.

## Report

Reply with a table: site or app, pass or fail, what you did, screenshot path. Then the npm and Playwright summaries, the cargo test summary, and the security review as pass or fail with file references. Do not merge.
