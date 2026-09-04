# Prompt Lab release versioning

Status: canonical

Last updated: 2026-09-04

## Scope

This document defines release-version behavior for the shared Prompt Lab product
line: the browser extension, hosted web app, and Tauri desktop app. The native
SwiftUI app keeps its own marketing version and build number until a separate
release decision explicitly joins it to the shared version line.

## Accepted release decision

- The next feature release is `1.8.0`.
- The current shared source remains `1.7.1` and unreleased until the required
  version tooling is implemented and used.
- A local or CI build does not become a release merely because it compiles or
  carries the next version number. A release also requires a matching source
  tag, successful release workflow, published artifacts, and distribution
  verification where applicable.

## Version source of truth

`prompt-lab-source/package.json` is the canonical shared product version. All
other distributed version fields must match it exactly.

The version-bump tool must update this complete allowlist:

| Surface | Version fields |
| --- | --- |
| Root package | `prompt-lab-source/package.json` and its lockfile |
| Extension package | `prompt-lab-extension/package.json` and its lockfile |
| Extension manifests | `extension/manifest.json` and `public/manifest.json` |
| Hosted web package | `prompt-lab-web/package.json` and its lockfile |
| Desktop package | `prompt-lab-desktop/package.json` and its lockfile |
| Tauri bundle | `prompt-lab-desktop/src-tauri/tauri.conf.json` |
| Rust crate | `prompt-lab-desktop/src-tauri/Cargo.toml` and the Prompt Lab package entry in `Cargo.lock` |
| Shared UI | `prompt-lab-extension/src/constants.js` (`APP_VERSION`) |

Compatibility and schema versions are not product-release versions. The tool
must not change library export fixtures, JSON contract versions, database
schema versions, dependency versions, or the native SwiftUI version unless the
corresponding format, dependency, or native release is intentionally changing.

## Required version-bump command

Implement one command at the shared source root:

```bash
npm run version:bump -- 1.8.0
```

The package script must call a single maintained implementation, expected at
`scripts/bump-version.mjs`. It must:

1. accept a bare stable semantic version in `major.minor.patch` form
2. reject invalid, unchanged, or lower versions
3. update only the version allowlist above
4. update application lockfile metadata without changing dependency versions
5. run the version-consistency check after writing
6. print the old version, new version, and changed files
7. exit nonzero without a partial write when validation fails

Distributed version files must not be bumped independently. The command is the
only supported way to change the shared product version once implemented.

## Required CI guard

Implement `npm run version:check`, backed by
`scripts/check-version-consistency.mjs`. It must parse every allowlisted field,
compare it with `prompt-lab-source/package.json`, print each mismatch, and exit
nonzero when any value differs.

The check must run:

- on every pull request that changes shared product, package, manifest, Tauri,
  Cargo, UI-version, or release-workflow files
- on pushes to `main`
- before any extension, desktop, web, or release build publishes an artifact

CI must include a regression test proving that a deliberately mismatched copy
fails. A text search alone is insufficient because `Cargo.lock` and JSON
lockfiles contain unrelated dependency versions.

## Required release tag guard

The manual release workflow accepts a tag-shaped input such as `v1.8.0`. Before
tests, builds, tag creation, or release publication, it must:

1. validate the input as `v<major>.<minor>.<patch>`
2. remove the leading `v`
3. read the canonical version from `prompt-lab-source/package.json`
4. run `npm run version:check`
5. fail when the normalized input and canonical version differ

For example, a workflow input of `v1.8.1` must fail while the internal version
is `1.8.0`. The workflow must never create a tag whose name disagrees with the
application metadata packaged into its artifacts.

## Development build identity

Development builds must show both the planned product version and the exact
source revision. The shared UI format is:

```text
1.8.0-dev (c7e6974)
```

Requirements:

- `APP_VERSION` continues to hold the stable numeric product version.
- A separate build-time value holds the short Git commit identifier.
- Local builds derive the identifier from `git rev-parse --short HEAD`.
- CI builds derive it from `GITHUB_SHA` and shorten it consistently.
- Non-release builds append `-dev`; tagged release builds omit that suffix but
  may still show the commit identifier in About or diagnostics UI.
- Tauri/macOS/Windows bundle metadata remains a platform-valid numeric version;
  the development label is display metadata, not a malformed bundle version.
- If the commit identifier is unavailable, the UI shows `unknown` rather than
  silently displaying a release-looking version.

The commit identifier proves source provenance. A timestamp or local build
number alone does not.

## Implementation status

| Requirement | State |
| --- | --- |
| Next feature release is `1.8.0` | Accepted |
| One allowlisted version-bump script | Required; not yet implemented |
| CI rejects mismatched versions | Required; not yet implemented |
| Release tag must match the internal version | Required; not yet implemented |
| Development UI shows version plus commit | Required; not yet implemented |

Until every required control is implemented and verified, `1.8.0` release
promotion remains blocked. Documentation of the requirement is not evidence
that the automation exists.

## Acceptance checks

- `npm run version:bump -- 1.8.0` updates every allowlisted field and no schema,
  fixture, dependency, or native-app version.
- `npm run version:check` passes after the bump.
- Changing any one allowlisted field makes `npm run version:check` fail.
- Release input `v1.8.0` passes the version comparison; `v1.8.1` fails before
  artifact creation.
- A development build visibly reports `1.8.0-dev (<short-sha>)`.
- A release artifact reports internal version `1.8.0` and is attached to tag
  `v1.8.0` built from the same commit.
