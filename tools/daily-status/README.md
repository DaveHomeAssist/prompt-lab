# PromptLab Daily Status Runner

Purpose: run the daily status task without executing `collect.mjs` or `render.mjs` directly from a cowork FUSE mount.

## Run

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run daily-status:deep --prefix prompt-lab-source
```

The bootstrap copies `collect.mjs` and `render.mjs` to local scratch, sets `PROMPTLAB_REPO` to the repo path, runs both scripts from scratch, then writes artifacts back.

## Write Contract

Canonical outputs are immutable run artifacts:

```text
daily-status/runs/<run-id>.status.json
daily-status/runs/<run-id>.latest.html
```

The runner also writes dated snapshots for compatibility with the scheduled dashboard task:

```text
daily-status/status-<YYYY-MM-DD>.json
daily-status/<YYYY-MM-DD>-promptlab-status.html
```

`daily-status/status.json` and `daily-status/latest.html` are convenience aliases. Dated snapshots and alias replacement are best effort because cowork mounts can deadlock when overwriting existing files. If replacement fails with `EDEADLK` or errno `-35`, the run still succeeds as long as the immutable run artifacts validate. The scratch manifest names the generated artifacts and warnings.

Each status JSON includes `runIdentity.target`, `runIdentity.semanticFingerprint`, and duplicate metadata. If two same-day runs produce the same semantic fingerprint, the newer run is marked `runIdentity.isDuplicate=true` and points at the previous `generatedAt`. Dashboard consumers should group by `runIdentity.target`, show the newest run, and expose older matching runs in drilldown history.

Set `PROMPTLAB_REQUIRE_ALIAS_WRITE=1` only when the environment must fail on stale aliases.

## Deep Checks

Deep mode never runs `npm` against an unsafe cowork mount. It uses this order:

1. `PROMPTLAB_CHECK_REPO`
2. `PROMPTLAB_LOCAL_REPO`
3. `PROMPTLAB_REPO`, only when the path does not look like a FUSE session mount and dependencies are installed

If none are available, build and test cells are omitted and the dashboard reports the missing local check repo as an environment issue instead of a code health result.

## Useful Environment

```sh
PROMPTLAB_REPO=/sessions/<id>/mnt/prompt-lab
PROMPTLAB_CHECK_REPO=/tmp/prompt-lab-check
PROMPTLAB_DAILY_STATUS_SCRATCH=/tmp/promptlab-daily-status
PROMPTLAB_DEEP_COMMANDS=toolchain,build,test,audit
```

Use a local check repo with installed deps for meaningful deep mode.
