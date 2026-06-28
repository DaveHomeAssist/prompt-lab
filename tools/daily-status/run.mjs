#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDefault = resolve(scriptDir, "..", "..");
const args = parseArgs(process.argv.slice(2));
const repo = resolve(args.repo || process.env.PROMPTLAB_REPO || repoDefault);
const runId = buildRunId();
const scratchRoot = resolve(process.env.PROMPTLAB_DAILY_STATUS_SCRATCH || join(tmpdir(), "promptlab-daily-status"));
const scratch = join(scratchRoot, runId);
const outDir = resolve(args.outDir || process.env.PROMPTLAB_DAILY_STATUS_OUT_DIR || join(repo, "daily-status"));
const requireAlias = args.requireAlias || process.env.PROMPTLAB_REQUIRE_ALIAS_WRITE === "1";

mkdirSync(scratch, { recursive: true });

const collectPath = join(scratch, "collect.mjs");
const renderPath = join(scratch, "render.mjs");
const statusScratch = join(scratch, "status.json");
const htmlScratch = join(scratch, "latest.html");
const previousAlias = join(outDir, "status.json");

copyWithRetry(join(scriptDir, "collect.mjs"), collectPath);
copyWithRetry(join(scriptDir, "render.mjs"), renderPath);

const collectArgs = [collectPath, "--repo", repo, "--out", statusScratch];
if (existsSync(previousAlias)) collectArgs.push("--previous", previousAlias);
if (args.checkRepo || process.env.PROMPTLAB_CHECK_REPO || process.env.PROMPTLAB_LOCAL_REPO) {
  collectArgs.push("--check-repo", args.checkRepo || process.env.PROMPTLAB_CHECK_REPO || process.env.PROMPTLAB_LOCAL_REPO);
}
if (args.deep) collectArgs.push("--deep");
if (args.net) collectArgs.push("--net");

runNode(collectArgs);
runNode([renderPath, "--in", statusScratch, "--out", htmlScratch]);

const runDate = readRunDate(statusScratch);
const writeResult = writeOutputs({
  runId,
  runDate,
  outDir,
  statusScratch,
  htmlScratch,
  requireAlias,
});
const validation = validateArtifacts(writeResult, runDate);
writeResult.validation = validation;
if (!validation.ok) {
  writeResult.ok = false;
  writeResult.warnings.push(...validation.errors.map((error) => `validation failed: ${error}`));
}

const summary = {
  ok: writeResult.ok,
  runId,
  date: runDate,
  scratch,
  outDir,
  status: writeResult.status,
  html: writeResult.html,
  datedStatus: writeResult.datedStatus,
  datedHtml: writeResult.datedHtml,
  statusAlias: writeResult.statusAlias,
  htmlAlias: writeResult.htmlAlias,
  validation,
  warnings: writeResult.warnings,
};

writeFileSync(join(scratch, "writeback-manifest.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (!writeResult.ok) process.exit(2);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") parsed.repo = argv[++i];
    else if (arg === "--check-repo") parsed.checkRepo = argv[++i];
    else if (arg === "--out-dir") parsed.outDir = argv[++i];
    else if (arg === "--deep") parsed.deep = true;
    else if (arg === "--net") parsed.net = true;
    else if (arg === "--require-alias") parsed.requireAlias = true;
  }
  return parsed;
}

function runNode(nodeArgs) {
  execFileSync(process.execPath, nodeArgs, {
    env: {
      ...process.env,
      PROMPTLAB_REPO: repo,
      PROMPTLAB_CHECK_REPO: args.checkRepo || process.env.PROMPTLAB_CHECK_REPO || process.env.PROMPTLAB_LOCAL_REPO || "",
    },
    stdio: "inherit",
    timeout: 1000 * 60 * 30,
  });
}

function writeOutputs({ runId, runDate, outDir, statusScratch, htmlScratch, requireAlias }) {
  const warnings = [];
  const runsDir = join(outDir, "runs");
  const status = join(runsDir, `${runId}.status.json`);
  const html = join(runsDir, `${runId}.latest.html`);
  const datedStatus = join(outDir, `status-${runDate}.json`);
  const datedHtml = join(outDir, `${runDate}-promptlab-status.html`);
  const statusAlias = join(outDir, "status.json");
  const htmlAlias = join(outDir, "latest.html");

  try {
    mkdirSync(runsDir, { recursive: true });
    copyWithRetry(statusScratch, status);
    copyWithRetry(htmlScratch, html);
  } catch (error) {
    warnings.push(`run artifact write failed: ${error.message || error}`);
    return { ok: false, status, html, datedStatus, datedHtml, statusAlias, htmlAlias, warnings };
  }

  for (const [source, target, label] of [
    [statusScratch, datedStatus, "dated status"],
    [htmlScratch, datedHtml, "dated html"],
    [statusScratch, statusAlias, "status alias"],
    [htmlScratch, htmlAlias, "html alias"],
  ]) {
    try {
      replaceFromScratch(source, target);
    } catch (error) {
      const message = `${label} write failed: ${error.message || error}`;
      warnings.push(message);
      if (requireAlias) return { ok: false, status, html, datedStatus, datedHtml, statusAlias, htmlAlias, warnings };
    }
  }

  return { ok: true, status, html, datedStatus, datedHtml, statusAlias, htmlAlias, warnings };
}

function replaceFromScratch(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  const tempTarget = join(dirname(target), `.${runId}.${target.split("/").pop()}.tmp`);
  copyWithRetry(source, tempTarget);
  try {
    renameSync(tempTarget, target);
  } catch (error) {
    if (!isRetryableFsError(error)) throw error;
    rmSync(target, { force: true });
    renameSync(tempTarget, target);
  }
}

function copyWithRetry(source, target) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      copyFileSync(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableFsError(error)) break;
      sleep(attempt * 100);
    }
  }

  if (lastError && isRetryableFsError(lastError)) {
    const bytes = readFileSync(source);
    writeFileSync(target, bytes);
    return;
  }
  throw lastError;
}

function readRunDate(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed.date || localDate(new Date(parsed.generatedAt || Date.now()));
  } catch {
    return localDate(new Date());
  }
}

function validateArtifacts(result, runDate) {
  const errors = [];
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(result.status, "utf8"));
  } catch (error) {
    errors.push(`status JSON is not readable JSON: ${error.message || error}`);
  }

  if (parsed) {
    if (parsed.date !== runDate) errors.push(`status date ${parsed.date || "missing"} does not match ${runDate}`);
    const generatedAt = Date.parse(parsed.generatedAt || "");
    if (!Number.isFinite(generatedAt)) {
      errors.push("generatedAt is missing or invalid");
    } else if (Math.abs(Date.now() - generatedAt) > 10 * 60 * 1000) {
      errors.push("generatedAt is outside the last 10 minutes");
    }
  }

  for (const [label, path] of [
    ["html", result.html],
    ["dated html", result.datedHtml],
    ["dated status", result.datedStatus],
  ]) {
    try {
      if (!readFileSync(path).length) errors.push(`${label} is empty`);
    } catch (error) {
      errors.push(`${label} missing: ${error.message || error}`);
    }
  }

  if (!errors.length) {
    const html = readFileSync(result.html, "utf8");
    for (const snippet of ["Status matrix", "Deltas", "Probe health", "Generated"]) {
      if (!html.includes(snippet)) errors.push(`html missing ${snippet}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function isRetryableFsError(error) {
  return error?.code === "EDEADLK" || error?.errno === -35 || /EDEADLK|deadlock|errno -35/i.test(error?.message || "");
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function buildRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
