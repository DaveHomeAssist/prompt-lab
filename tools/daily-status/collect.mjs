#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUPPORTS_FETCH = typeof fetch === "function";
const NODE_MIN = { major: 22, minor: 12 };
const STALE_DAYS = 14;
const PROBE_TIMEOUT_MS = Number(process.env.PROMPTLAB_PROBE_TIMEOUT_MS) || 5000;
const MIRROR_TIMEOUT_MS = Number(process.env.PROMPTLAB_MIRROR_TIMEOUT_MS) || Math.max(PROBE_TIMEOUT_MS, 15000);

const args = parseArgs(process.argv.slice(2));
const repo = resolve(args.repo || process.env.PROMPTLAB_REPO || DEFAULT_REPO);
const out = args.out || process.env.PROMPTLAB_STATUS_OUT || "";
const deep = Boolean(args.deep);
const net = Boolean(args.net);
const checkRepo = resolveCheckRepo(repo);
const startedAt = new Date();
const previous = args.previous ? readJson(args.previous) : null;

const state = {
  schemaVersion: 1,
  project: { id: "prompt-lab", name: "Prompt Lab" },
  date: localDate(startedAt),
  generatedAt: startedAt.toISOString(),
  mode: { deep, net },
  repo,
  checkRepo,
  environment: collectEnvironment(repo),
  items: [],
  issues: [],
  deltas: [],
};

addNodeRuntime();
addMountProbe();
addGitState();
addIssueTracker();
addOpsFreshness();

if (deep) {
  addDeepChecks();
}

if (net) {
  await addLiveProbe();
}

state.counts = countStatuses(state.items);
state.summary = buildSummary(state.counts);
state.deltas = buildDeltas(previous, state);
state.regressionCount = state.deltas.filter((delta) => delta.regression).length;
state.runIdentity = buildRunIdentity(previous, state);
state.durationSeconds = elapsedSeconds(startedAt.getTime());

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(state, null, 2)}\n`, "utf8");
} else {
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--deep") parsed.deep = true;
    else if (arg === "--net") parsed.net = true;
    else if (arg === "--repo") parsed.repo = argv[++i];
    else if (arg === "--check-repo") parsed.checkRepo = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--previous") parsed.previous = argv[++i];
  }
  if (parsed.checkRepo) process.env.PROMPTLAB_CHECK_REPO = parsed.checkRepo;
  return parsed;
}

function addItem(label, status, detail, extra = {}) {
  state.items.push({ label, status, detail, ...extra });
}

function addNodeRuntime() {
  const version = process.versions.node;
  const [major, minor] = version.split(".").map((value) => Number(value));
  const ok = major > NODE_MIN.major || (major === NODE_MIN.major && minor >= NODE_MIN.minor);
  addItem(
    "Node runtime",
    ok ? "green" : "red",
    ok
      ? `Node ${version} is inside the supported window.`
      : `Node ${version} is below ${NODE_MIN.major}.${NODE_MIN.minor}.`,
  );
}

function addMountProbe() {
  const fsType = command("stat", ["-f", "%T", repo], { timeout: 5000 }).stdout || "unknown";
  const risky = isUnsafeMount(repo, fsType);
  const probePath = join(repo, "AGENTS.md");
  const probe = safeRead(probePath, { attempts: 2, delayMs: 50 });
  if (probe.ok && !risky) {
    addItem("Repo mount", "green", `Readable on ${fsType}.`, { fsType });
    return;
  }

  if (probe.ok && risky) {
    addItem("Repo mount", "amber", `Readable, but ${fsType} or path shape is treated as unsafe for npm.`, { fsType });
    return;
  }

  addItem("Repo mount", "grey", `Read probe failed: ${probe.error}`, { fsType, env: "mount" });
}

function addGitState() {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 5000 });
  addItem("Git branch", branch.ok ? "green" : "grey", branch.ok ? branch.stdout : branch.error);

  const status = git(["status", "--short", "--untracked-files=no"], { timeout: 10000 });
  if (!status.ok) {
    addItem(
      "Tracked worktree",
      "amber",
      `Tracked file scan timed out or was contended; local changes may exist. ${status.error}`,
      { env: "git" },
    );
  } else {
    addItem(
      "Tracked worktree",
      status.stdout ? "amber" : "green",
      status.stdout ? "Tracked files have local changes. Untracked scan is intentionally skipped for mount safety." : "Tracked files are clean.",
    );
  }

  addUnpushedProbe(branch.ok ? branch.stdout : null);
}

// Unpushed-commit probe. `git log --not --remotes` against a FUSE-mounted working
// tree bulk-reads .git and deadlocks (errno -35 / EDEADLK), which used to fall
// through to an opaque grey every run. This walks a fallback ladder, stopping on
// the first rung that returns a real hit/miss, and only greys out (with a concrete
// failureReason) when every rung has been tried and failed. Every git/rsync
// invocation is hard-killed after PROBE_TIMEOUT_MS so a deadlock can never block
// the run.
function addUnpushedProbe(branch) {
  const attempts = [];

  // Rung 0 — direct query when the repo is on a safe (non-FUSE) mount. This is the
  // common case on Dave's Mac and answers cheaply without any mirroring.
  if (!state.environment.unsafeMount) {
    const direct = probeViaGitDir(join(repo, ".git"), repo, "direct-worktree", branch);
    attempts.push(direct);
    if (direct.ok) return emitUnpushed(direct);
  }

  // Rung 1 — explicit non-FUSE clone via PROMPTLAB_REPO_LOCAL.
  const localRepo = process.env.PROMPTLAB_REPO_LOCAL;
  if (localRepo && existsSync(join(localRepo, ".git"))) {
    const local = probeViaGitDir(join(localRepo, ".git"), localRepo, "local-path", branch);
    attempts.push(local);
    if (local.ok) return emitUnpushed(local);
  }

  // Rung 2 — mirror .git into the writer's scratch dir and query the copy.
  const mirrored = probeMirroredGitDir(branch);
  attempts.push(mirrored);
  if (mirrored.ok) return emitUnpushed(mirrored);

  // Rung 3 — refs-only SHA diff (no history walk, smallest reads).
  const refsOnly = probeRefsOnly(branch);
  attempts.push(refsOnly);
  if (refsOnly.ok) return emitUnpushed(refsOnly);

  // Rung 4 — honest grey, annotated with why each rung failed.
  emitHonestGrey(attempts);
}

// Try `git rev-list @{u}...HEAD` (exact ahead/behind) and fall back to
// `git log --not --remotes` (count of commits on HEAD missing from every remote).
// Both run against an explicit --git-dir so nothing depends on cwd touching the mount.
function probeViaGitDir(gitDir, workTree, source, branch) {
  const base = ["--no-optional-locks", `--git-dir=${gitDir}`];
  if (workTree) base.push(`--work-tree=${workTree}`);
  const opts = { timeout: PROBE_TIMEOUT_MS, cwd: workTree || dirname(gitDir), killSignal: "SIGKILL" };

  const ahead = gitRaw([...base, "rev-list", "--left-right", "--count", "@{u}...HEAD"], opts);
  if (ahead.ok && /^\d+\s+\d+$/.test(ahead.stdout)) {
    const [behind, aheadCount] = ahead.stdout.split(/\s+/).map((value) => Number(value));
    return { ok: true, source, branch, count: aheadCount, behind, mode: "upstream-count" };
  }

  // `HEAD` must be named explicitly: `--remotes` already supplies revisions, so git
  // does NOT default the positive ref to HEAD and `--not --remotes` alone shows nothing.
  const log = gitRaw([...base, "log", "--oneline", "HEAD", "--not", "--remotes"], opts);
  if (log.ok) {
    const count = log.stdout ? log.stdout.split("\n").filter(Boolean).length : 0;
    return { ok: true, source, branch, count, mode: "log-not-remotes" };
  }

  const aheadReason = ahead.ok ? "error" : classifyGitFailure(ahead);
  return { ok: false, source, failureReason: aheadReason !== "error" ? aheadReason : classifyGitFailure(log) };
}

// Rung 2: rsync .git into the same scratch dir the writer already uses (dirname of
// --out), excluding *.lock to dodge pack/index lock contention, then query the copy.
function probeMirroredGitDir(branch) {
  const source = "mirrored-git-dir";
  const gitSource = join(repo, ".git");
  if (!existsSync(gitSource)) return { ok: false, source, failureReason: "not-a-git-dir" };

  const mirrorGitDir = join(scratchBaseDir(), "git-mirror", ".git");
  try {
    mkdirSync(mirrorGitDir, { recursive: true });
  } catch (error) {
    return { ok: false, source, failureReason: isRetryableFsError(error) ? "deadlock" : "error" };
  }

  // The copy itself is bounded I/O, not a history walk, so it gets a more generous
  // (separately tunable) timeout than the git queries — a slow-but-not-deadlocked
  // mount can still finish mirroring. If it does deadlock, SIGKILL fires and we drop
  // to the refs-only rung. Incremental re-runs (-a) are cheap after the first copy.
  const rsync = command(
    "rsync",
    ["-a", "--delete", "--exclude=*.lock", `${gitSource}/`, `${mirrorGitDir}/`],
    { timeout: MIRROR_TIMEOUT_MS, cwd: dirname(mirrorGitDir), killSignal: "SIGKILL" },
  );
  if (!rsync.ok) return { ok: false, source, failureReason: classifyGitFailure(rsync) };

  const result = probeViaGitDir(mirrorGitDir, null, source, branch);
  return result.ok ? result : { ok: false, source, failureReason: result.failureReason || "error" };
}

// Rung 3: compare local head SHAs against every remote ref SHA using only small ref
// reads (refs/heads, refs/remotes, packed-refs) — no object walk, so no bulk-read
// deadlock. Counts local branches whose tip SHA is absent from all remote refs. This
// is an approximation (SHA equality, not reachability), flagged as such in the payload.
function probeRefsOnly(branch) {
  const source = "refs-only";
  const gitDir = join(repo, ".git");
  const byName = new Map();
  for (const ref of [...readLooseRefs(join(gitDir, "refs"), "refs/"), ...readPackedRefs(gitDir)]) {
    if (!byName.has(ref.name)) byName.set(ref.name, ref.sha);
  }
  if (!byName.size) return { ok: false, source, failureReason: "not-a-git-dir" };

  const remoteShas = new Set();
  const locals = [];
  for (const [name, sha] of byName) {
    if (name.startsWith("refs/remotes/")) remoteShas.add(sha);
    else if (name.startsWith("refs/heads/")) locals.push({ name: name.slice("refs/heads/".length), sha });
  }
  if (!locals.length) return { ok: false, source, failureReason: "not-a-git-dir" };

  const unpushed = locals.filter((head) => !remoteShas.has(head.sha)).map((head) => head.name);
  // Whether the *current* branch is among the unpushed set drives the status, to stay
  // consistent with rungs 0/1 (which measure HEAD vs remotes). null = branch unknown.
  const currentUnpushed = branch ? unpushed.includes(branch) : null;
  // Surface the current branch first so the headline names it.
  if (branch && currentUnpushed) {
    unpushed.splice(unpushed.indexOf(branch), 1);
    unpushed.unshift(branch);
  }
  return {
    ok: true,
    source,
    branch,
    count: unpushed.length,
    branches: unpushed,
    currentUnpushed,
    approximate: true,
    mode: "refs-sha-diff",
  };
}

function emitUnpushed(result) {
  const branch = result.branch || "HEAD";
  const count = Number.isFinite(result.count) ? result.count : 0;
  const extra = { source: result.source, unpushedCount: count, branch, probeMode: result.mode || "" };
  if (Number.isFinite(result.behind)) extra.behind = result.behind;
  if (result.approximate) extra.approximate = true;
  if (Array.isArray(result.branches)) extra.unpushedBranches = result.branches;
  if (result.currentUnpushed !== undefined) extra.currentBranchUnpushed = result.currentUnpushed;

  let status;
  let detail;
  if (result.source === "refs-only") {
    // Approximate rung: status follows the current branch when we know which one it is;
    // other unpushed local branches are reported but don't flip a clean current branch.
    const others = result.branches.filter((name) => name !== result.branch);
    const othersNote = others.length ? ` (+${others.length} other local branch(es): ${others.slice(0, 4).join(", ")}${others.length > 4 ? "…" : ""})` : "";
    if (result.currentUnpushed === true) {
      status = "amber";
      detail = `\`${branch}\` head not on any remote — likely unpushed (approx)${othersNote}.`;
    } else if (result.currentUnpushed === false) {
      status = count ? "amber" : "green";
      detail = count
        ? `\`${branch}\` is pushed; ${count} other local branch head(s) not on any remote (approx): ${result.branches.slice(0, 4).join(", ")}${result.branches.length > 4 ? "…" : ""}.`
        : `All local branch heads match a remote ref.`;
    } else {
      // Branch unknown (git unavailable): can't isolate the current branch.
      status = count ? "amber" : "green";
      detail = count
        ? `${count} local branch head(s) not on any remote (approx): ${result.branches.slice(0, 5).join(", ")}${result.branches.length > 5 ? "…" : ""}.`
        : "All local branch heads match a remote ref.";
    }
  } else {
    status = count > 0 ? "amber" : "green";
    detail = count
      ? `${count} unpushed on \`${branch}\`${Number.isFinite(result.behind) && result.behind ? ` / ${result.behind} behind upstream` : ""}.`
      : `No unpushed commits on \`${branch}\`.`;
  }
  detail += ` [source: ${result.source}]`;
  addItem("Unpushed commits", status, detail, extra);
}

function emitHonestGrey(attempts) {
  const trail = attempts.map((a) => `${a.source}:${a.failureReason || "unavailable"}`);
  const specific = attempts.find((a) => a.failureReason && a.failureReason !== "error");
  const failureReason = specific?.failureReason || attempts[attempts.length - 1]?.failureReason || "unavailable";
  addItem(
    "Unpushed commits",
    "grey",
    `Unpushed-commit probe unverifiable; every fallback failed (${trail.join("; ")}).`,
    { env: "git", source: null, failureReason, attempts: trail },
  );
}

// Scratch dir the writer already uses == dirname of --out; standalone runs fall
// back to a temp dir so the mirror never lands on the contended mount.
function scratchBaseDir() {
  return out ? dirname(resolve(out)) : join(tmpdir(), "promptlab-daily-status", "probe-scratch");
}

function readLooseRefs(baseDir, prefix) {
  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const refs = [];
  for (const entry of entries) {
    const full = join(baseDir, entry.name);
    if (entry.isDirectory()) {
      refs.push(...readLooseRefs(full, `${prefix}${entry.name}/`));
    } else {
      const read = safeRead(full, { attempts: 2, delayMs: 50 });
      if (read.ok && /^[0-9a-f]{40}/.test(read.value.trim())) {
        refs.push({ name: `${prefix}${entry.name}`, sha: read.value.trim().slice(0, 40) });
      }
    }
  }
  return refs;
}

function readPackedRefs(gitDir) {
  const read = safeRead(join(gitDir, "packed-refs"), { attempts: 2, delayMs: 50 });
  if (!read.ok) return [];
  return read.value
    .split("\n")
    .filter((line) => /^[0-9a-f]{40}\s+refs\//.test(line))
    .map((line) => {
      const [sha, name] = line.trim().split(/\s+/);
      return { name, sha };
    });
}

function classifyGitFailure(result) {
  if (!result) return "error";
  if (
    result.killed
    || result.signal === "SIGKILL"
    || result.signal === "SIGTERM"
    || result.code === "ETIMEDOUT"
    || /ETIMEDOUT|timed out/i.test(result.error || "")
  ) {
    return "timeout";
  }
  const text = `${result.stderr || ""} ${result.error || ""}`;
  if (/EDEADLK|deadlock|errno -35/i.test(text)) return "deadlock";
  if (/not a git repository|does not exist|--git-dir/i.test(text)) return "not-a-git-dir";
  return "error";
}

function gitRaw(args, options = {}) {
  return command("git", args, options);
}

function addIssueTracker() {
  const path = join(repo, "AGENTS.md");
  const read = safeRead(path);
  if (!read.ok) {
    addItem("Issue tracker", "grey", `AGENTS.md unavailable: ${read.error}`, { env: "mount" });
    return;
  }

  const issues = parseIssueRows(read.value);
  state.issues = issues;
  const openP1 = issues.filter((issue) => /^(P0|P1)$/i.test(issue.severity) && isOpen(issue.status));
  const openAny = issues.filter((issue) => isOpen(issue.status));
  addItem(
    "Issue tracker",
    openP1.length ? "red" : openAny.length ? "amber" : "green",
    openP1.length ? `${openP1.length} open P0/P1: ${openP1.map((issue) => `#${issue.id}`).join(", ")}` : `${openAny.length} open nonblocking issue(s).`,
  );
}

function addOpsFreshness() {
  for (const [label, relative] of [
    ["ops-state.json freshness", "ops-state.json"],
    ["ops-dashboard.html freshness", "ops-dashboard.html"],
  ]) {
    const path = join(repo, relative);
    const stat = safeStat(path);
    if (!stat.ok) {
      addItem(label, "grey", `${relative} unavailable: ${stat.error}`, { env: "mount" });
      continue;
    }
    const days = Math.floor((Date.now() - stat.value.mtimeMs) / 86400000);
    addItem(label, days > STALE_DAYS ? "amber" : "green", `${relative} last modified ${days} day(s) ago.`);
  }
}

function addDeepChecks() {
  if (!checkRepo) {
    addItem(
      "Deep check source",
      "amber",
      "No safe local check repo with installed deps is available. Set PROMPTLAB_CHECK_REPO to run build and test off the mount.",
      { env: "deep" },
    );
    return;
  }

  addItem("Deep check source", "green", `Using ${checkRepo}.`);
  const source = join(checkRepo, "prompt-lab-source");
  const commands = (process.env.PROMPTLAB_DEEP_COMMANDS || "toolchain,build,test,audit")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const commandMap = {
    toolchain: {
      label: "Toolchain alignment",
      args: ["run", "toolchain:check"],
      timeout: 180000,
    },
    build: {
      label: "Shell build smoke",
      args: ["run", "build:smoke"],
      timeout: 600000,
    },
    test: {
      label: "Extension tests",
      args: ["test"],
      timeout: 420000,
    },
    audit: {
      label: "Root npm audit",
      args: ["audit", "--audit-level=moderate"],
      timeout: 180000,
    },
  };

  for (const name of commands) {
    const spec = commandMap[name];
    if (!spec) continue;
    const result = command("npm", spec.args, { cwd: source, timeout: spec.timeout });
    addItem(
      spec.label,
      result.ok ? "green" : "red",
      result.ok ? summarizeOutput(result.stdout || result.stderr, "passed") : summarizeOutput(result.stderr || result.stdout || result.error, "failed"),
      { command: `npm ${spec.args.join(" ")}`, seconds: result.seconds },
    );
  }
}

async function addLiveProbe() {
  if (!SUPPORTS_FETCH) {
    addItem("Live site probe", "grey", "fetch is unavailable in this Node runtime.", { env: "net" });
    return;
  }

  const url = "https://promptlab.tools";
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const ms = Date.now() - started;
    addItem("Live site probe", response.ok ? "green" : "red", `${url} -> HTTP ${response.status} in ${ms}ms.`);
  } catch (error) {
    addItem("Live site probe", "grey", `${url} probe failed: ${error?.message || error}`, { env: "net" });
  } finally {
    clearTimeout(timer);
  }
}

function resolveCheckRepo(mainRepo) {
  const explicit = process.env.PROMPTLAB_CHECK_REPO || process.env.PROMPTLAB_LOCAL_REPO;
  if (explicit && isUsableCheckRepo(explicit)) return resolve(explicit);

  const fsType = command("stat", ["-f", "%T", mainRepo], { timeout: 5000 }).stdout || "unknown";
  if (!isUnsafeMount(mainRepo, fsType) && isUsableCheckRepo(mainRepo)) return mainRepo;
  return null;
}

function isUsableCheckRepo(candidate) {
  const root = resolve(candidate);
  return existsSync(join(root, "prompt-lab-source", "package.json"))
    && existsSync(join(root, "prompt-lab-source", "node_modules"))
    && existsSync(join(root, "prompt-lab-source", "prompt-lab-extension", "node_modules"))
    && existsSync(join(root, "prompt-lab-source", "prompt-lab-web", "node_modules"))
    && existsSync(join(root, "prompt-lab-source", "prompt-lab-desktop", "node_modules"));
}

function collectEnvironment(targetRepo) {
  const fsType = command("stat", ["-f", "%T", targetRepo], { timeout: 5000 }).stdout || "unknown";
  return {
    node: process.versions.node,
    platform: process.platform,
    fsType,
    unsafeMount: isUnsafeMount(targetRepo, fsType),
  };
}

function isUnsafeMount(path, fsType) {
  return process.env.PROMPTLAB_MOUNT_UNSAFE === "1"
    || path.startsWith("/sessions/")
    || /fuse|osxfuse|macfuse|cowork/i.test(fsType);
}

function parseIssueRows(markdown) {
  return markdown
    .split("\n")
    .filter((line) => /^\|\s*\d{3}\s*\|/.test(line))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      return {
        id: cells[0] || "",
        severity: cells[1] || "",
        status: cells[2] || "",
        title: cells[3] || "",
        notes: cells[4] || "",
      };
    });
}

function isOpen(status) {
  return /^(open|in-progress)$/i.test(status);
}

function countStatuses(items) {
  return items.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, { red: 0, amber: 0, green: 0, grey: 0 });
}

function buildSummary(counts) {
  if (counts.red) return `${counts.red} red / ${counts.amber} amber / ${counts.green} healthy`;
  if (counts.amber) return `${counts.amber} amber / ${counts.green} healthy`;
  return `${counts.green} healthy`;
}

function buildDeltas(oldState, newState) {
  if (!oldState?.items) return [];
  const rank = { green: 0, grey: 0, amber: 1, red: 2 };
  const oldByLabel = new Map(oldState.items.map((item) => [item.label, item.status]));
  return newState.items
    .filter((item) => oldByLabel.has(item.label) && oldByLabel.get(item.label) !== item.status)
    .map((item) => ({
      label: item.label,
      from: oldByLabel.get(item.label),
      to: item.status,
      regression: (rank[item.status] || 0) > (rank[oldByLabel.get(item.label)] || 0),
    }));
}

function buildRunIdentity(oldState, newState) {
  const target = `prompt-lab:daily-status:${newState.date}`;
  const semanticFingerprint = semanticRunFingerprint(newState, target);
  const previousFingerprint = oldState
    ? oldState.runIdentity?.semanticFingerprint || semanticRunFingerprint(oldState, target)
    : "";
  const previousGeneratedAt = typeof oldState?.generatedAt === "string" ? oldState.generatedAt : "";
  const sameTarget = !oldState?.runIdentity?.target || oldState.runIdentity.target === target;
  const sameDay = oldState?.date === newState.date;
  const isDuplicate = Boolean(oldState && sameDay && sameTarget && previousFingerprint === semanticFingerprint);

  return {
    target,
    semanticFingerprint,
    isDuplicate,
    duplicateOf: isDuplicate ? previousGeneratedAt || null : null,
    previousGeneratedAt: previousGeneratedAt || null,
  };
}

function semanticRunFingerprint(statusState, target) {
  const payload = {
    target,
    project: statusState.project?.id || "",
    date: statusState.date || "",
    mode: statusState.mode || {},
    counts: statusState.counts || countStatuses(statusState.items || []),
    items: (statusState.items || []).map((item) => ({
      label: item.label || "",
      status: item.status || "",
      detail: item.detail || "",
      env: item.env || "",
      command: item.command || "",
    })),
    issues: (statusState.issues || []).map((issue) => ({
      id: issue.id || "",
      severity: issue.severity || "",
      status: issue.status || "",
      title: issue.title || "",
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function git(args, options = {}) {
  return command("git", ["-C", repo, ...args], options);
}

function command(file, commandArgs, options = {}) {
  const started = Date.now();
  try {
    const stdout = execFileSync(file, commandArgs, {
      cwd: options.cwd || repo,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout || 30000,
      killSignal: options.killSignal,
      maxBuffer: 1024 * 1024 * 20,
    }).trim();
    return { ok: true, stdout, stderr: "", seconds: elapsedSeconds(started) };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || "").trim(),
      stderr: String(error.stderr || "").trim(),
      error: error.message || String(error),
      killed: Boolean(error.killed),
      signal: error.signal || null,
      code: error.code || null,
      seconds: elapsedSeconds(started),
    };
  }
}

function safeRead(path, options = {}) {
  const attempts = options.attempts || 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { ok: true, value: readFileSync(path, "utf8") };
    } catch (error) {
      if (attempt === attempts || !isRetryableFsError(error)) {
        return { ok: false, error: error.message || String(error) };
      }
      sleep(options.delayMs || attempt * 100);
    }
  }
  return { ok: false, error: "read failed" };
}

function safeStat(path) {
  try {
    return { ok: true, value: statSync(path) };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

function readJson(path) {
  const read = safeRead(path, { attempts: 1 });
  if (!read.ok) return null;
  try {
    return JSON.parse(read.value);
  } catch {
    return null;
  }
}

function isRetryableFsError(error) {
  return error?.code === "EDEADLK" || error?.errno === -35 || /EDEADLK|deadlock|errno -35/i.test(error?.message || "");
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function elapsedSeconds(started) {
  return Math.round((Date.now() - started) / 100) / 10;
}

function localDate(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.PROMPTLAB_TIME_ZONE || "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function summarizeOutput(text, fallback) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return fallback;
  return lines.slice(-4).join(" ");
}
