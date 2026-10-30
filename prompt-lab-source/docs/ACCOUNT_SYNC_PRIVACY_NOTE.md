# Account sync: draft Privacy and Terms additions

Status: draft for Dave's review (rollout step R10). **Not applied to the live Privacy or Terms pages.** The pending terms-final branch (decisions D1 to D5) is untouched. Merge these into that work only after Dave approves the wording and the provider facts are rechecked at activation.

Facts to confirm at activation: the Supabase project region (suggested `us-east-1`), the final quota numbers, and whether sync is on for every signed-in user or opt-in.

## Privacy Policy additions

### Account sync

When you are signed in to Prompt Lab, your Library is copied to your account so it is available on your other devices and is not lost if you clear your browser data. This applies on promptlab.tools, in the Chrome extension and in the desktop app once each supports sign-in.

**What is synced:**
- prompts in your Library and Trash, including their text, notes, tags, collection, version history stored with the prompt, and timestamps;
- your collections, folders and the list of starter packs you have loaded;
- for each change: a random device identifier, a counter used to order edits, and the time of the change.

**What is not synced:** provider API keys, model settings, Scratch pads, run and evaluation history, telemetry settings and billing details. These stay on the device.

**Where it is stored:** in a database run for Prompt Lab by Supabase, Inc. (region: [confirm]). Sign-in is handled by Clerk, Inc., which already provides Prompt Lab accounts. Your synced data is linked to your Clerk account id. It is not linked to your email address in the sync database.

**Who can see it:** only your signed-in account. Database rules keep each account's data separate. Prompt Lab does not read, sell or use your synced prompts for advertising or model training. Operators may access the database only to keep the service running, investigate abuse or comply with law.

**Conflicts:** if the same prompt is changed on two devices before they sync, the most recent change is kept and the other version is saved as a conflict copy in your account (the latest few per prompt, up to 2 MiB per account; older copies are removed first), so it can be recovered.

**Retention and deletion:**
- Synced data is kept while your account exists.
- Deleting a prompt permanently removes its content from your account; a small deletion marker without content remains so other devices delete it too.
- You can delete all synced data from Settings, which leaves the copy on your device.
- Deleting your Prompt Lab account deletes your synced data automatically.
- The free database tier keeps no provider backups; any operator backup (weekly, private) is overwritten within [N] weeks.

**Export:** you can download your synced data and a copy of this device's Library as JSON at any time.

**Sensitive content:** prompts can contain personal or confidential information. Signing in syncs them. Remove anything you do not want stored in your account, or stay signed out to keep the Library on this device only.

### Processors (add to the existing list)

| Processor | Purpose | Data |
| --- | --- | --- |
| Supabase, Inc. | Sync database | Synced Library content, Clerk account id, device id, timestamps |
| Clerk, Inc. | Sign-in (existing) | Account identity; also session cookies read by the extension for sign-in |

## Terms of Service additions

### Account sync

- Sync is provided as is, on a best-effort basis, and may be paused, limited or discontinued.
- Fair-use limits apply, for example about 5,000 prompts, 10 MB of synced content and 256 KB per prompt. Prompts above the limit stay on your device and are not synced.
- We may pause sync for everyone to protect the service; your device copy is not affected.
- Sync is not a backup service. Keep your own exports of anything important.
- You are responsible for the content you sync and must have the right to store it.
- Automated or abusive use, including creating accounts to consume storage, may lead to sync being disabled for that account.

## Chrome Web Store permission justification (for R9)

- `cookies`: "Reads the Prompt Lab sign-in session from promptlab.tools so the extension can sync your Library with your account. No other site's cookies are read."
- `https://clerk.promptlab.tools/*`: "Prompt Lab's sign-in service."
- `https://<ref>.supabase.co/*`: "Prompt Lab's sync database for your Library."
