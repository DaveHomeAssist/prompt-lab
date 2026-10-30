# Prompt Lab Desktop

Prompt Lab Desktop is a Tauri 2 shell around the shared Prompt Lab React frontend. It reuses `../prompt-lab-extension/src/` so the desktop app stays aligned with:

- the hosted web app at `https://promptlab.tools/app/`
- the MV3 browser extension in `prompt-lab-extension/`

## Prerequisites

- Node.js 22.x
- Rust toolchain with `cargo`
- Tauri platform dependencies for your OS
  - macOS: Xcode command line tools
  - Linux: WebKitGTK/AppIndicator/RSVG packages
  - Windows: WebView2 + MSVC build tools

## Development

```bash
cd prompt-lab-source/prompt-lab-desktop
npm install
cargo tauri dev
```

## Build

```bash
cd prompt-lab-source/prompt-lab-desktop
npm install
cargo tauri build
```

## Packaged library service candidate

The Tauri build prepares the shared library service with Vite and includes a
Node 22 sidecar, its license and a file hash manifest. Users do not need Node
installed. Build preparation needs access to official Node downloads; macOS
universal builds verify the second architecture against the official checksum
list and combine both architectures. Generated resources remain outside Git.

Run `npm run prepare:library` and `npm run verify:library` to verify resources
and the packaged process contract. Linux and macOS run the process suite.
Windows verifies resources only: actual directory flushing currently returns
`EPERM`, so Windows folder activation remains unavailable. Linux activation
also remains unavailable until its secure-store acceptance passes. These
restrictions do not disable existing import/export.

The native owner uses private pipes and a platform credential store. No
credential is passed through process arguments, environment variables or the
library folder. The picker, migration review and user pairing are still pending;
this candidate does not activate a library. macOS folder service requires macOS
11 or later, matching the [Node 22 runtime requirements](https://github.com/nodejs/node/blob/v22.23.4/BUILDING.md#platform-list).
The existing shell minimum does not establish folder-service compatibility.

Native unit checks are `cargo test --bin prompt-lab-desktop` in `src-tauri`.
The ignored `secure_store_roundtrip_and_expiry_rotation` acceptance test creates
and removes a disposable credential only when explicitly selected with
`-- --ignored`; it requires a real user credential-store session. An SSH network
logon on Windows can return `ERROR_NO_SUCH_LOGON_SESSION` before a write. Keep
that failure separate from ordinary unit checks and installed app acceptance.

The Linux filesystem acceptance uses an unprivileged helper on a dedicated
16 MiB in-memory filesystem. It exercises actual full-disk and permission
errors, retained commits, restart and idempotent retry. From the repository
root on a qualified Linux Docker runner:

```bash
docker run --rm --network none --read-only --memory 256m --cpus 1 --pids-limit 64 \
  --user 1000:1000 \
  --tmpfs /fixture:rw,size=16m,uid=1000,gid=1000,mode=0700 \
  -v "$PWD:/work:ro" node:22-bookworm-slim \
  node /work/prompt-lab-source/scripts/verify-folder-environment.mjs /fixture
```

The script refuses root, nonempty directories, ordinary filesystems and
filesystems larger than 32 MiB. It never uses a personal library. This check
does not establish macOS permissions, browser draft recovery or installed
application behavior.

## Desktop Controls

- Zoom with `Command +` / `Command -` on macOS or `Ctrl +` / `Ctrl -` on Windows and Linux. Reset with `Command 0` or `Ctrl 0`.
- Provider Settings can target Ollama on This Mac, Duncan, Walter, or a custom URL. Selecting a known server refreshes its installed model list.
- Packaged network access is allowlisted to the known Ollama hosts. A custom server must also be added to the desktop content security policy before it can be used in a packaged build.

## More Docs

- `../ARCHITECTURE.md` — shared platform and runtime layout
- `../ROADMAP.md` — current product and release priorities
- `../docs/release-versioning.md` — shared version bump, CI, release tag, and development build identity contract
- `../prompt-lab-web/README.md` — hosted web deployment notes
