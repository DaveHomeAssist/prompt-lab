# Library workspace controls

Date: 2026-10-17. Source: Dave's eight annotated hosted Library comments.

## User problem and outcome

Library navigation and an empty inspector consume fixed space; two navigation
levels make destinations harder to find. Collections need folder organization,
items need visual identities, and users need more display and palette choices.
The fixed version label gives no indication of deployed source changes.

## Smallest useful slice

1. Persist a collapsible Library drawer, reachable from the results toolbar.
2. Resize the inspector with a pointer or keyboard; clamp width to the viewport.
3. Put Write, Library, Compose, Dual Pane, Evaluate and Scratch in one workspace
   navigation row. Retain Evaluate's History/Compare controls and existing routes.
4. Offer Ember, Ocean, Forest and Plum palettes, each with light/dark mode.
5. Assign a built-in icon or a bounded local PNG/JPEG/WebP to each prompt or
   collection. Store prompt artwork in metadata; collection artwork is a local
   UI preference. No external image requests or new dependencies.
6. Represent nested folders as collection paths separated by `/`. Add a parent
   chooser and collapsible tree; show descendants when selecting a parent.
   Preserve legacy collection strings and prompt assignments.
7. Offer list, tiles, compact and gallery displays, persisted per installation.
8. Implement the accepted release-versioning contract: synchronized version
   tooling, mismatch and tag guards, and source revision in development labels.
   Advance shared source to the accepted planned 1.8.0 version; this does not
   publish a tagged desktop/extension release.

## Flow and boundaries

Toolbar opens the drawer; collection management creates folders and edits their
artwork. Inspect a prompt to edit artwork with its existing Details save action.
Folder deletion retains prompts under the existing collection deletion contract;
folder renaming also updates descendant paths and assignments. Flat collection
selectors and exports retain their string format. Collection artwork/layout
preferences are local and excluded from workspace exports. No provider, billing,
cloud sync, native iOS, or personal Library data changes.

## Acceptance and risks

Exercise drawer reopen and reload, pointer/keyboard resize, all navigation routes,
light/dark palettes, artwork save/reload and invalid files, nested create/filter/
rename, all four views and legacy import/export. Run focused and broader existing
regressions under Node 22 on Dominic. Browser checks include 375×812, 1440×900,
1920×1080 and 32:9, with no document overflow. Confirm the new deployed build
identity separately from CI and retain installed native/human acceptance gaps.
Folder names using `/` become paths; do not rewrite their stored values. Local
artwork can consume storage, so cap images and preserve honest save failure UI.
