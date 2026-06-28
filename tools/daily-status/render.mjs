#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = parseArgs(process.argv.slice(2));
const input = args.input || process.env.PROMPTLAB_STATUS_IN;
const out = args.out || process.env.PROMPTLAB_HTML_OUT || "";

if (!input) {
  console.error("render.mjs requires --in <status.json>");
  process.exit(2);
}

const state = JSON.parse(readFileSync(input, "utf8"));
const html = render(state);

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, "utf8");
} else {
  process.stdout.write(html);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--in") parsed.input = argv[++i];
    else if (argv[i] === "--out") parsed.out = argv[++i];
  }
  return parsed;
}

function render(state) {
  const counts = state.counts || {};
  const generated = state.generatedAt ? new Date(state.generatedAt) : new Date();
  const mode = [
    state.mode?.deep ? "deep mode" : "standard mode",
    state.mode?.net ? "net on" : "net off",
  ].join(" / ");
  const items = Array.isArray(state.items) ? state.items : [];
  const issues = Array.isArray(state.issues) ? state.issues : [];
  const deltas = Array.isArray(state.deltas) ? state.deltas : [];
  const runIdentity = state.runIdentity || {};
  const probeItems = items.filter((item) => /probe|mount|site/i.test(item.label));
  const deepItems = items.filter((item) => item.command || /deep check source/i.test(item.label));
  const duplicateLine = runIdentity.isDuplicate
    ? ` / duplicate run vs ${escapeHtml(formatDateTime(runIdentity.duplicateOf || runIdentity.previousGeneratedAt))}`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prompt Lab Daily Status ${escapeHtml(generated.toISOString().slice(0, 10))}</title>
<style>
  :root {
    --bg: #101216; --panel: #171b22; --panel-2: #202632; --text: #eef1f6; --muted: #a7afbd;
    --border: #303846; --green: #2ecc71; --amber: #f5a623; --red: #ff5c5c; --grey: #7d8796;
    --accent: #7c9cff;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f7f8fa; --panel:#fff; --panel-2:#eef1f5; --text:#141821; --muted:#5f6876; --border:#dfe4eb; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 28px 20px 60px; }
  header { display:flex; flex-wrap:wrap; align-items:baseline; gap:10px 16px; border-bottom:1px solid var(--border); padding-bottom:16px; }
  h1 { font-size:20px; margin:0; }
  .sub, .meta, .cell-detail, footer { color:var(--muted); }
  .headline { margin:18px 0 4px; font-size:22px; font-weight:700; }
  .meta { font-size:12.5px; margin-bottom:18px; }
  .counts { display:flex; gap:10px; flex-wrap:wrap; margin:16px 0 8px; }
  .pill { padding:6px 12px; border-radius:999px; font-weight:700; font-size:13px; border:1px solid var(--border); background:var(--panel); }
  .pill.red b{ color:var(--red);} .pill.amber b{ color:var(--amber);} .pill.green b{ color:var(--green);} .pill.grey b{ color:var(--grey);}
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:12px; margin-top:14px; }
  .cell { background:var(--panel); border:1px solid var(--border); border-left-width:4px; border-radius:8px; padding:12px 14px; min-height:104px; }
  .cell.green { border-left-color:var(--green);} .cell.amber{ border-left-color:var(--amber);} .cell.red{ border-left-color:var(--red);} .cell.grey{ border-left-color:var(--grey);}
  .cell-top { display:flex; align-items:center; gap:8px; }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--grey); flex:none; }
  .cell.green .dot{background:var(--green);} .cell.amber .dot{background:var(--amber);} .cell.red .dot{background:var(--red);}
  .cell-label { font-weight:700; }
  .cell-status { margin-left:auto; font-size:11px; letter-spacing:.5px; color:var(--muted); text-transform:uppercase; }
  .cell-detail { font-size:13px; margin-top:6px; overflow-wrap:anywhere; }
  .block { margin-top:30px; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); margin:0 0 10px; }
  ul.deltas { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
  ul.deltas li { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:8px 12px; font-size:13.5px; }
  table.status-table { width:100%; border-collapse:collapse; font-size:13px; }
  table.status-table th, table.status-table td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
  table.status-table th { color:var(--muted); font-weight:700; }
  .badge { display:inline-block; min-width:54px; text-align:center; border-radius:999px; padding:2px 8px; background:var(--panel-2); font-size:11px; text-transform:uppercase; }
  code { background:var(--panel-2); padding:1px 5px; border-radius:4px; font-size:12.5px; }
  .empty { color:var(--muted); font-style:italic; }
  footer { margin-top:36px; font-size:12px; border-top:1px solid var(--border); padding-top:14px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Prompt Lab Daily Status</h1>
      <span class="sub">${escapeHtml(generated.toISOString().slice(0, 10))} / ${escapeHtml(mode)}</span>
    </header>

    <div class="headline">${escapeHtml(state.summary || "Status generated")}</div>
    <div class="meta">
      Generated ${escapeHtml(generated.toLocaleString())}
      / repo ${escapeHtml(state.repo || "unknown")}
      / check repo ${escapeHtml(state.checkRepo || "none")}
      / target ${escapeHtml(runIdentity.target || "prompt-lab:daily-status")}
      / fingerprint ${escapeHtml(runIdentity.semanticFingerprint || "none")}
      ${duplicateLine}
    </div>

    <div class="counts">
      <span class="pill red"><b>${counts.red || 0}</b> red</span>
      <span class="pill amber"><b>${counts.amber || 0}</b> amber</span>
      <span class="pill green"><b>${counts.green || 0}</b> healthy</span>
      <span class="pill grey"><b>${counts.grey || 0}</b> n/a</span>
      <span class="pill amber"><b>${state.regressionCount || 0}</b> regressions</span>
    </div>

    <section class="block">
      <h2>Status matrix</h2>
      <div class="grid">
        ${items.map(renderItem).join("\n")}
      </div>
    </section>

    <section class="block">
      <h2>Deltas</h2>
      ${renderDeltas(deltas, runIdentity)}
    </section>

    <section class="block">
      <h2>Probe health</h2>
      ${probeItems.length ? renderItemTable(probeItems) : '<div class="empty">No probe checks ran.</div>'}
    </section>

    <section class="block">
      <h2>Deep checks</h2>
      ${deepItems.length ? renderItemTable(deepItems) : '<div class="empty">Deep mode was not requested.</div>'}
    </section>

    <section class="block">
      <h2>Issue tracker</h2>
      ${issues.length ? renderIssueTable(issues) : '<div class="empty">No issues parsed.</div>'}
    </section>

    <footer>
      Prompt Lab daily status dashboard / generated by <code>tools/daily-status/collect.mjs</code> and <code>tools/daily-status/render.mjs</code>
      / duration ${escapeHtml(state.durationSeconds ?? "unknown")}s.
    </footer>
  </div>
</body>
</html>
`;
}

function renderItem(item) {
  const status = ["green", "amber", "red", "grey"].includes(item.status) ? item.status : "grey";
  return `<div class="cell ${status}">
  <div class="cell-top">
    <span class="dot"></span>
    <span class="cell-label">${escapeHtml(item.label)}</span>
    <span class="cell-status">${escapeHtml(status)}</span>
  </div>
  <div class="cell-detail">${escapeHtml(item.detail || "")}</div>
</div>`;
}

function renderDelta(delta) {
  return `<li><code>${escapeHtml(delta.label)}</code>: <b>${escapeHtml(delta.from)}</b> to <b>${escapeHtml(delta.to)}</b></li>`;
}

function renderDeltas(deltas, runIdentity) {
  if (deltas.length) return `<ul class="deltas">${deltas.map(renderDelta).join("")}</ul>`;
  if (runIdentity?.isDuplicate) {
    return `<ul class="deltas"><li><code>Duplicate run</code>: semantic state matches previous run at <b>${escapeHtml(formatDateTime(runIdentity.duplicateOf || runIdentity.previousGeneratedAt))}</b>. Group by target and show the newest run.</li></ul>`;
  }
  return '<div class="empty">No previous status changes detected.</div>';
}

function renderIssueTable(issues) {
  return `<table class="status-table">
    <thead><tr><th>ID</th><th>Severity</th><th>Status</th><th>Title</th></tr></thead>
    <tbody>${issues.map((issue) => `<tr><td>#${escapeHtml(issue.id)}</td><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.status)}</td><td>${escapeHtml(issue.title)}</td></tr>`).join("")}</tbody>
  </table>`;
}

function renderItemTable(items) {
  return `<table class="status-table">
    <thead><tr><th>Name</th><th>Status</th><th>Detail</th><th>Command</th></tr></thead>
    <tbody>${items.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td><span class="badge">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.detail || "")}</td><td>${item.command ? `<code>${escapeHtml(item.command)}</code>` : ""}</td></tr>`).join("")}</tbody>
  </table>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function formatDateTime(value) {
  if (!value) return "unknown";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : String(value);
}
