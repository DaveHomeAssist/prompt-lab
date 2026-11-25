# Library organization and review

Status: active workflow guide

Use this workflow when an imported Library is large enough that finding and reviewing prompts takes longer than using them.

## Back up and scope the work

1. Open **Library** and choose **Export**. Check that the workspace JSON opens and includes the expected number of saved prompts.
2. Keep the export and any prompt-level review list in private storage. Workspace exports can include prompt text, Scratch notes, runs, and test cases.
3. Use **Filter by project profile** to scope the work to the imported profile. Record its count and the total saved count before filing.

## File and verify in batches

1. Use collections for each prompt's main job and tags for projects that cut across collections. Reuse an existing collection when it fits.
2. Start with a small batch. Check every selected title before using **Move to** or **Add tag**. Open the destination collection with the profile filter still applied and verify its membership.
3. Expand to prompts whose purpose is clear from their contents or source packs. Use **Details** to consolidate verified tag aliases while preserving the other tags.
4. Favorite a small working set. In **Details**, add a one-line **Purpose** describing when to use each prompt, then choose **Save details**.
5. Reload the app and recheck collection membership, profile and Library counts, tag filters, Favorites, and Purpose notes. Verify any cross-device synchronization separately in another signed-in surface.

## Review the remaining prompts

| Review group | Next action |
| --- | --- |
| Shared title | Compare prompt bodies, inputs, and version history. Give prompts with distinct jobs specific titles. Review close matches before consolidating. |
| Captured run or variant | Identify reusable prompts, useful format variants, and references that depend on a prior session. File each according to its purpose. |
| Context and placement | Read the prompt and identify its main job. Give project-specific prompts enough context in the title to be found later. |
| Older exports | Compare normalized prompt bodies with the current Library before importing. In the import preview, check the counts and review conflicts where titles or IDs match. |

## Verified example

A November 25, 2026 check in the signed-in hosted Library filed **383 of 505** prompts in an imported profile. A 30-prompt pilot was followed by 353 additional assignments across nine collections. Reloading the app confirmed the assignments, updated tags, and all 12 Favorites with their Purpose notes.

The 122 unfiled prompts comprised 20 entries with shared titles, 37 captured runs or variants, and 65 entries that needed context before filing. The shared-title review spanned 11 pairs, including five with substantial wording overlap. Cross-device sync remained unverified.

See the [Library compatibility contract](LIBRARY_COMPATIBILITY_CONTRACT.md) for import and persistence behavior and [Project profiles](project-profiles.md) for profile fields and transfer.
