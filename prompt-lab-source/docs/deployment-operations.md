# Prompt Lab Deployment Operations

Updated: 2026-08-05

## Source of truth

| Item | Authoritative value |
|---|---|
| GitHub repository | `DaveHomeAssist/prompt-lab` |
| Production branch | `main` |
| Production Vercel project | `prompt-lab` in the `daves-projects-7059ba1c` team |
| Production Vercel project ID | `prj_kynCeAMcASaNBIBMRHVJb7sozDfN` |
| Production domains | `promptlab.tools`, `www.promptlab.tools`, `mobile.promptlab.tools` |
| Vercel config | `prompt-lab-source/vercel.json` |
| Deploy helper | `prompt-lab-source/scripts/vercel-deploy.mjs` |

The custom domains are served by Vercel. The GitHub Pages workflow publishes a
static mirror from `docs/`, but GitHub Pages is not the authoritative runtime
for the custom domain or the `/api` functions.

## Verified deployment inventory

Snapshot verified on 2026-08-05:

| Project | Project ID | Custom production domains | Latest observed state | Disposition |
|---|---|---|---|---|
| `prompt-lab` | `prj_kynCeAMcASaNBIBMRHVJb7sozDfN` | `promptlab.tools`, `www.promptlab.tools`, `mobile.promptlab.tools` | Production `READY` at GitHub commit `07e2964c3a54e031bb13173ddc2b95833d5697bc` | Authoritative; retain |
| `prompt-lab-main-clean` | `prj_w75H3224S8iTl6GSJvbRgVkR0jxD` | None | Latest deployment `BLOCKED`; posts a failing GitHub status on `main` | Disconnect/archive after owner approval |
| `prompt-lab-web` | `prj_gfq7QUgMkRmUvWRiq2BUTVmZOJQk` | None | Legacy Vercel production deployment; no current custom domain | Review separately before archive |
| `prompt-lab-source` | `prj_cFEPEiOI17bd1TRthXNQf3cSRta6` | None | Legacy Vercel production deployment; no current custom domain | Review separately before archive |

The two legacy projects are not part of the `prompt-lab-main-clean` approval.
They may contain useful rollback history, so do not delete or disconnect them
without a separate inventory and owner decision.

The GitHub status on `main` commit
`07e2964c3a54e031bb13173ddc2b95833d5697bc` currently contains:

- `Vercel - prompt-lab`: success
- `Vercel - prompt-lab-main-clean`: failure

GitHub Pages is also built from `main:/docs`, reports `promptlab.tools` as its
custom domain, and does not enforce HTTPS. Public DNS resolves
`promptlab.tools` to Vercel (`76.76.21.21`), and live responses identify
Vercel as the server.

## Current configuration debt

- The Vercel project `prompt-lab-main-clean` is connected to the same GitHub
  repository but owns no production custom domain.
- Its deployments are blocked and its GitHub deployment status can make the
  combined status for an otherwise healthy commit appear failed.
- GitHub Pages still has `promptlab.tools` configured as its custom domain even
  though live DNS traffic is served by Vercel.

Disconnecting or deleting a Vercel project and removing a Pages custom domain
are external control-plane changes. Verify domains and obtain owner approval
before making either change.

Vercel project metadata currently reports Node 22.x for `prompt-lab`, while the
repository's supported build runtime is Node 20.x. The root `package.json`,
`.nvmrc`, and all active GitHub workflows use Node 20. Confirm the effective
Vercel build runtime on the next preview before changing the project setting.

## Approved cleanup procedure

Only perform these steps after the owner explicitly selects a Pages policy and
approves the duplicate-project change.

1. Capture the current `prompt-lab-main-clean` project settings and latest
   deployment URL for rollback evidence.
2. Verify again that the project has no custom domains or environment values
   required by `prompt-lab`.
3. Disconnect its Git repository integration. Prefer disconnection over
   deletion for the first cleanup pass so deployment history remains
   recoverable.
4. Push or rerun a non-production verification commit and confirm only the
   authoritative `Vercel - prompt-lab` status is posted.
5. For GitHub Pages, choose exactly one policy:
   - **Repository mirror:** remove the Pages custom domain and `docs/CNAME`,
     retain the Pages workflow, and use the repository Pages URL.
   - **No mirror:** disable Pages and remove `docs/CNAME` in a separately
     reviewed change.
6. Confirm `promptlab.tools`, `www.promptlab.tools`, and
   `mobile.promptlab.tools` still resolve to the authoritative Vercel project.
7. Record the completed changes, verification commit, and rollback reference
   in this runbook.

## Local preflight

Run from `prompt-lab-source/` with the Node version in `.nvmrc`:

```powershell
npm ci
npm ci --prefix prompt-lab-extension
npm ci --prefix prompt-lab-web
npm run test
npm run build
npm run build:landing
npm run docs:lint
```

For desktop verification, also run:

```powershell
npm ci --prefix prompt-lab-desktop
npm run verify:desktop
npm run package:desktop
npm run test:ollama
```

`test:ollama` discovers locally installed models, selects the smallest by
download size, and runs the real Balanced enhancement contract through the
desktop provider adapter. Override selection with `OLLAMA_MODEL`,
`OLLAMA_BASE_URL`, or `OLLAMA_CONTEXT_LENGTH` when needed. It does not run in
CI because it requires a local Ollama service and model.

## Deploy

The repository-local helper requires `prompt-lab-source/.vercel/project.json`
to be linked to the authoritative `prompt-lab` project. Never commit `.vercel`
metadata or access tokens.

Preview deployment from `prompt-lab-source/`:

```powershell
npm run deploy:preview
```

Production deployment from `prompt-lab-source/`:

```powershell
npm run deploy:prod
```

Prefer the GitHub integration for normal `main` deployments. Use the manual
production command for a controlled recovery or when the Git integration is
unavailable.

## Post-deploy verification

1. Confirm the Vercel production deployment is `READY` and references the
   intended `main` commit.
2. Confirm `https://promptlab.tools/` returns the landing page.
3. Confirm `https://promptlab.tools/app/` loads the shared workbench.
4. Confirm `https://promptlab.tools/privacy` resolves.
5. Exercise one hosted provider request through `/api/proxy` with an approved
   test account or key.
6. Scan Vercel runtime errors for the production deployment.
7. Confirm the `Vercel - prompt-lab` GitHub status is successful.

## Rollback

1. Identify the last known-good production deployment in the `prompt-lab`
   Vercel project.
2. Verify its commit and build metadata.
3. Promote that deployment or use Vercel's rollback control.
4. Repeat every post-deploy verification check.
5. Record the failed deployment, rollback target, and observed failure before
   attempting a new production deployment.
