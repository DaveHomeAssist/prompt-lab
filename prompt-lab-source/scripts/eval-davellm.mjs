#!/usr/bin/env node
// DL-EVAL-01 milestone 2: run Library Test cases through DaveLLM's stateless POST /eval/chat
// and score them with the app's own Enhance payload, PII gate, parser and trait checker.
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertSupportedNode } from './require-node.mjs';
import {
  ALL_TAGS,
  buildSystemPrompt,
  DEFAULT_ENHANCE_MAX_TOKENS,
  DEFAULT_ENHANCE_MODEL,
  DEFAULT_ENHANCE_TEMPERATURE,
  MODES,
} from '../prompt-lab-extension/src/constants.js';
import { checkTraits, parseEnhancedPayload } from '../prompt-lab-extension/src/promptUtils.js';
import { scanSensitiveData } from '../prompt-lab-extension/src/piiScanner.js';
import { normalizeTestCaseRecord } from '../prompt-lab-extension/src/lib/evalSchema.js';

export const DEFAULT_ROUTER = 'http://127.0.0.1:8000';
// D-EVAL-04 A: the first live run is ten cases, one pass.
export const DEFAULT_CASE_LIMIT = 10;
export const DEFAULT_MODE = 'balanced';
// The router's own deadline is 600 s per call; leave room for it to answer with 504.
export const EVAL_REQUEST_TIMEOUT_MS = 660_000;
const SETUP_REQUEST_TIMEOUT_MS = 30_000;
const OUTPUT_KEEP_CHARS = 4000;

export const OUTCOMES = Object.freeze([
  'pass', 'fail', 'unscored', 'blocked', 'invalid_json', 'no_enhanced', 'truncated', 'empty',
  'tool_call_only', 'error', 'skipped', 'dry_run',
]);

export const JSON_CONSTRAINED_NOTE = 'Replies were constrained with `format: "json"`. Prompt Lab\'s own Ollama '
  + 'adapter sends no `format`, so these pass rates are not what the app\'s Ollama provider would get.';

const USAGE = `Usage: node scripts/eval-davellm.mjs --input <workspace.json> --node <id> --models <a,b> [options]

Runs Library Test cases through DaveLLM's POST /eval/chat with the app's Enhance prompt and
scores them with the app's own checkTraits. Reads the API key from DAVE_API_KEY.

  --input <file>      Workspace export (testCases[], optional library[]) or an array of cases
  --node <id>         DaveLLM node id from GET /nodes, for example walter
  --models <a,b>      Comma-separated model ids from that node's inventory
  --router <url>      DaveLLM base URL (default DAVE_ROUTER_URL or ${DEFAULT_ROUTER})
  --cases <n>         Run the first n cases (default ${DEFAULT_CASE_LIMIT})
  --case-ids <a,b>    Run exactly these case ids instead
  --mode <id>         Enhance mode (default ${DEFAULT_MODE})
  --max-tokens <n>    Reply budget (default ${DEFAULT_ENHANCE_MAX_TOKENS}, the app's)
  --no-format         Do not send format "json" (D-EVAL-05 B); sent by default
  --out <dir>         Report folder (default: the input's folder)
  --dry-run           Check inventory and the PII gate; call no model
  --help              Show this help`;

export class EvalSetupError extends Error {}

export function parseCliArgs(argv, env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string' },
      node: { type: 'string' },
      models: { type: 'string' },
      router: { type: 'string' },
      cases: { type: 'string' },
      'case-ids': { type: 'string' },
      mode: { type: 'string' },
      'max-tokens': { type: 'string' },
      'no-format': { type: 'boolean', default: false },
      out: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) return { help: true };
  for (const key of ['input', 'node', 'models']) {
    if (!values[key]) throw new EvalSetupError(`--${key} is required.\n\n${USAGE}`);
  }
  const list = (text) => String(text || '').split(',').map((item) => item.trim()).filter(Boolean);
  const positive = (text, name, fallback) => {
    if (text === undefined) return fallback;
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1) throw new EvalSetupError(`${name} must be a positive integer.`);
    return value;
  };
  const models = list(values.models);
  if (!models.length) throw new EvalSetupError('--models must name at least one model.');
  // buildSystemPrompt falls back to the first mode for an unknown id, so a typo would run
  // one mode while the report names another.
  const mode = values.mode || DEFAULT_MODE;
  if (!MODES.some((item) => item.id === mode)) {
    throw new EvalSetupError(`Unknown --mode "${mode}". Use one of: ${MODES.map((item) => item.id).join(', ')}.`);
  }
  const apiKey = env.DAVE_API_KEY || '';
  if (!apiKey) throw new EvalSetupError('Set DAVE_API_KEY to the DaveLLM API key before running.');
  return {
    input: resolve(values.input),
    node: values.node,
    models,
    router: String(values.router || env.DAVE_ROUTER_URL || DEFAULT_ROUTER).replace(/\/+$/, ''),
    caseLimit: positive(values.cases, '--cases', DEFAULT_CASE_LIMIT),
    caseIds: list(values['case-ids']),
    mode,
    maxTokens: positive(values['max-tokens'], '--max-tokens', DEFAULT_ENHANCE_MAX_TOKENS),
    format: values['no-format'] ? null : 'json',
    out: values.out ? resolve(values.out) : null,
    dryRun: values['dry-run'],
    apiKey,
  };
}

export function loadCases(document, { caseLimit = DEFAULT_CASE_LIMIT, caseIds = [] } = {}) {
  const rows = Array.isArray(document) ? document : document?.testCases;
  if (!Array.isArray(rows)) {
    throw new EvalSetupError('Input must be a workspace export with testCases[] or an array of test cases.');
  }
  const titles = new Map((Array.isArray(document?.library) ? document.library : [])
    .map((entry) => [entry?.id, entry?.title]));
  const all = rows.map((row) => ({
    ...normalizeTestCaseRecord(row || {}),
    promptTitle: String(titles.get(row?.promptId) || ''),
  }));
  let cases;
  if (caseIds.length) {
    const byId = new Map(all.map((testCase) => [testCase.id, testCase]));
    const missing = caseIds.filter((id) => !byId.has(id));
    if (missing.length) throw new EvalSetupError(`Unknown case ids: ${missing.join(', ')}`);
    cases = caseIds.map((id) => byId.get(id));
  } else {
    cases = all.slice(0, caseLimit);
  }
  if (!cases.length) throw new EvalSetupError('No test cases to run.');
  return cases;
}

// The exact payload the app builds for a Library Test (useExecutionFlow buildEnhancePayloadFor).
export function buildAppPayload(input, { mode = DEFAULT_MODE, maxTokens = DEFAULT_ENHANCE_MAX_TOKENS } = {}) {
  return {
    model: DEFAULT_ENHANCE_MODEL,
    max_tokens: maxTokens,
    temperature: DEFAULT_ENHANCE_TEMPERATURE,
    system: buildSystemPrompt(mode, ALL_TAGS),
    messages: [{ role: 'user', content: input }],
    responseFormat: 'json',
  };
}

export function buildEvalRequest(appPayload, { node, model, format }) {
  return {
    node_id: node,
    model,
    messages: [{ role: 'system', content: appPayload.system }, ...appPayload.messages],
    max_tokens: appPayload.max_tokens,
    temperature: appPayload.temperature,
    ...(format ? { format } : {}),
  };
}

// Sorts an /eval/chat reply the way the app would treat it, with the error cases kept apart:
// parseEnhancedPayload throws for empty, non-JSON and enhanced-less replies, and the app scores
// nothing for them. A reply cut off by max_tokens is "truncated" unless the parser could still
// recover a complete enhanced string, in which case it is scored and flagged.
export function classifyReply(body) {
  const doneReason = body?.done_reason ?? null;
  if (body?.reason === 'tool_call_only') return { outcome: 'tool_call_only', doneReason };
  try {
    const parsed = parseEnhancedPayload(body?.response);
    return { outcome: 'parsed', enhanced: parsed.enhanced, truncated: doneReason === 'length', doneReason };
  } catch (error) {
    const message = String(error?.message || error);
    if (doneReason === 'length') return { outcome: 'truncated', parseError: message, doneReason };
    if (/empty content/i.test(message)) return { outcome: 'empty', parseError: message, doneReason };
    if (/missing an enhanced/i.test(message)) return { outcome: 'no_enhanced', parseError: message, doneReason };
    return { outcome: 'invalid_json', parseError: message, doneReason };
  }
}

export function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = SETUP_REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = transport.request(target, {
      method,
      headers: {
        Accept: 'application/json',
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolvePromise({ status: response.statusCode, json, text });
      });
      response.on('error', (error) => { clearTimeout(timer); reject(error); });
    });
    // A wall-clock deadline for the whole exchange: /eval/chat sends its headers only
    // when the reply is complete, so per-socket idle timers would not bound it.
    const timer = setTimeout(() => request.destroy(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    request.on('error', (error) => { clearTimeout(timer); reject(error); });
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

function routerDetail(response) {
  const detail = response?.json?.detail;
  if (typeof detail === 'string') return detail;
  if (detail !== undefined) return JSON.stringify(detail).slice(0, 300);
  return String(response?.text || '').slice(0, 300);
}

async function setupCall(request, router, path, apiKey) {
  let response;
  try {
    response = await request(`${router}${path}`, { headers: { 'X-API-Key': apiKey } });
  } catch (error) {
    throw new EvalSetupError(`Cannot reach DaveLLM at ${router}: ${error.message}`);
  }
  if (response.status === 401) throw new EvalSetupError('DaveLLM refused the API key (HTTP 401). Check DAVE_API_KEY.');
  if (response.status !== 200) {
    throw new EvalSetupError(`DaveLLM GET ${path} answered HTTP ${response.status}: ${routerDetail(response)}`);
  }
  return response.json;
}

// Same rule the app enforces: a chat must name a node from /nodes and a model from its inventory.
export async function checkInventory({ request, router, apiKey, node, models }) {
  const nodes = await setupCall(request, router, '/nodes', apiKey);
  const ids = (Array.isArray(nodes) ? nodes : []).map((entry) => entry?.id);
  if (!ids.includes(node)) {
    throw new EvalSetupError(`Node '${node}' is not configured on this router. Known nodes: ${ids.join(', ') || 'none'}.`);
  }
  const listing = await setupCall(request, router, `/nodes/${encodeURIComponent(node)}/models`, apiKey);
  if (listing?.error) throw new EvalSetupError(`Node '${node}' inventory is unavailable: ${listing.error}`);
  const available = (Array.isArray(listing?.models) ? listing.models : []).map((entry) => entry?.id);
  const missing = models.filter((model) => !available.includes(model));
  if (missing.length) {
    throw new EvalSetupError(`Not in ${node}'s inventory: ${missing.join(', ')}. Available: ${available.join(', ') || 'none'}.`);
  }
  return available;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function countInto(map, items) {
  for (const item of items || []) map.set(item, (map.get(item) || 0) + 1);
}

export function summarize(cases) {
  const counts = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
  for (const entry of cases) counts[entry.status] += 1;
  const missed = new Map();
  const banned = new Map();
  for (const entry of cases) {
    countInto(missed, entry.failedTraits);
    countInto(banned, entry.excludedHits);
  }
  const sent = cases.filter((entry) => entry.sent);
  const scored = counts.pass + counts.fail;
  return {
    cases: cases.length,
    sent: sent.length,
    ...counts,
    truncatedButScored: cases.filter((entry) => entry.truncatedButScored).length,
    passRate: scored ? counts.pass / scored : null,
    medianLatencyMs: median(sent.map((entry) => entry.latencyMs)),
    medianGenTps: median(sent.map((entry) => entry.genTps)),
    totalGenTokens: sent.reduce((total, entry) => total + (entry.genTokens || 0), 0),
    missedPhrases: [...missed.entries()].sort((a, b) => b[1] - a[1]),
    bannedHits: [...banned.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function caseRecord(testCase, fields) {
  return {
    caseId: testCase.id,
    title: testCase.title,
    promptTitle: testCase.promptTitle,
    status: 'error',
    sent: false,
    verdict: null,
    passedTraits: [],
    failedTraits: [],
    excludedHits: [],
    doneReason: null,
    truncatedButScored: false,
    genTokens: null,
    genTps: null,
    latencyMs: null,
    httpStatus: null,
    error: null,
    output: '',
    ...fields,
  };
}

async function runCase({ request, options, model, testCase }) {
  const appPayload = buildAppPayload(testCase.input, options);
  // F7: the app gates every send on the PII scan of the payload it built.
  const { matches } = scanSensitiveData({ payload: appPayload });
  if (matches.length > 0) {
    return caseRecord(testCase, { status: 'blocked', error: 'PII gate blocked the case before any send.' });
  }
  if (options.dryRun) return caseRecord(testCase, { status: 'dry_run' });

  const started = Date.now();
  let response;
  try {
    response = await request(`${options.router}/eval/chat`, {
      method: 'POST',
      headers: { 'X-API-Key': options.apiKey },
      body: buildEvalRequest(appPayload, { node: options.node, model, format: options.format }),
      timeoutMs: EVAL_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    return caseRecord(testCase, { error: `Request failed: ${error.message}`, latencyMs: Date.now() - started });
  }
  if (response.status === 401) throw new EvalSetupError('DaveLLM refused the API key (HTTP 401). Check DAVE_API_KEY.');
  if (response.status !== 200) {
    return caseRecord(testCase, {
      sent: true, httpStatus: response.status, error: `HTTP ${response.status}: ${routerDetail(response)}`,
      latencyMs: Date.now() - started,
    });
  }
  const body = response.json || {};
  const reply = classifyReply(body);
  const common = {
    sent: true,
    httpStatus: 200,
    doneReason: reply.doneReason,
    genTokens: body.stats?.gen_tokens ?? null,
    genTps: body.stats?.gen_tps ?? null,
    latencyMs: Number.isFinite(body.latency_ms) ? body.latency_ms : Date.now() - started,
  };
  if (reply.outcome !== 'parsed') {
    return caseRecord(testCase, {
      ...common, status: reply.outcome, error: reply.parseError || body.notice || null,
      output: String(body.response || '').slice(0, OUTPUT_KEEP_CHARS),
    });
  }
  // Scored exactly as runTestCaseJob does, on the parsed enhanced prompt.
  const traits = checkTraits(reply.enhanced, testCase.expectedTraits, testCase.expectedExclusions);
  return caseRecord(testCase, {
    ...common,
    status: traits.verdict === null ? 'unscored' : traits.verdict,
    verdict: traits.verdict,
    passedTraits: traits.passedTraits,
    failedTraits: traits.failedTraits,
    excludedHits: traits.excludedHits,
    truncatedButScored: reply.truncated,
    output: reply.enhanced.slice(0, OUTPUT_KEEP_CHARS),
  });
}

// Why a model's run stops early, or null to continue. The first case doubles as the smoke check:
// one that runs out of max_tokens or comes back empty would waste the rest of the pass.
export function stopReason(record, { first }) {
  if (record.httpStatus === 503) return 'the router could not connect to the node';
  if (!first || !record.sent) return null;
  if (record.doneReason === 'length') return 'the first case ran out of max_tokens';
  if (record.status === 'empty' || record.status === 'tool_call_only') return 'the first case returned no content';
  return null;
}

export async function runEval(options, { request = requestJson, log = () => {}, now = () => new Date() } = {}) {
  const startedAt = now().toISOString();
  const document = JSON.parse(readFileSync(options.input, 'utf8'));
  const cases = loadCases(document, options);
  await checkInventory({ request, router: options.router, apiKey: options.apiKey, node: options.node, models: options.models });

  const results = {};
  for (const model of options.models) {
    const records = [];
    let stopped = null;
    let firstSent = true;
    for (const [index, testCase] of cases.entries()) {
      if (stopped) {
        records.push(caseRecord(testCase, { status: 'skipped', error: `Skipped: ${stopped}.` }));
        continue;
      }
      const record = await runCase({ request, options, model, testCase });
      records.push(record);
      log(`[${model}] ${index + 1}/${cases.length} ${testCase.title}: ${record.status}`
        + (record.latencyMs ? ` (${(record.latencyMs / 1000).toFixed(1)} s)` : ''));
      stopped = stopReason(record, { first: firstSent });
      if (record.sent) firstSent = false;
      if (stopped) log(`[${model}] stopping: ${stopped}`);
    }
    results[model] = { summary: summarize(records), stoppedEarly: stopped, cases: records };
  }

  return {
    tool: 'eval-davellm',
    reportVersion: 1,
    startedAt,
    finishedAt: now().toISOString(),
    router: options.router,
    node: options.node,
    models: options.models,
    input: basename(options.input),
    mode: options.mode,
    maxTokens: options.maxTokens,
    temperature: DEFAULT_ENHANCE_TEMPERATURE,
    format: options.format,
    jsonConstrained: options.format === 'json',
    dryRun: options.dryRun,
    caseCount: cases.length,
    results,
  };
}

const cell = (value) => String(value ?? '-').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '-';
const percent = (value) => (value === null ? '-' : `${Math.round(value * 100)}%`);
const phrases = (entries) => (entries.length ? entries.map(([text, count]) => `${text} (${count})`).join(', ') : '-');

export function renderMarkdown(report) {
  const lines = [
    '# DaveLLM Library Test report',
    '',
    `- Router: ${report.router}; node: ${report.node}; input: ${report.input}`,
    `- ${report.caseCount} cases, one pass; Enhance mode ${report.mode}; max_tokens ${report.maxTokens}; temperature ${report.temperature}`,
    `- Format: ${report.format ? `\`${report.format}\`` : 'none (unconstrained)'}${report.dryRun ? '; dry run, no model was called' : ''}`,
    `- ${report.startedAt} to ${report.finishedAt}`,
    '',
  ];
  if (report.jsonConstrained) lines.push(`> ${JSON_CONSTRAINED_NOTE}`, '');
  lines.push(
    '| model | cases | pass | fail | unscored | blocked | invalid JSON | no enhanced | truncated | empty | tool call only | errors | skipped | pass rate | median ms | median tok/s |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const model of report.models) {
    const s = report.results[model].summary;
    lines.push(`| ${cell(model)} | ${s.cases} | ${s.pass} | ${s.fail} | ${s.unscored} | ${s.blocked} | ${s.invalid_json} | ${s.no_enhanced} | ${s.truncated} | ${s.empty} | ${s.tool_call_only} | ${s.error} | ${s.skipped} | ${percent(s.passRate)} | ${cell(s.medianLatencyMs === null ? null : Math.round(s.medianLatencyMs))} | ${cell(s.medianGenTps)} |`);
  }
  lines.push('', 'Pass rate counts scored cases only (pass and fail). "Truncated" replies ran out of max_tokens before a complete `enhanced` prompt; a reply cut off after `enhanced` closed is still scored and listed below.', '');
  for (const model of report.models) {
    const { summary, stoppedEarly, cases } = report.results[model];
    lines.push(`## ${model}`, '');
    if (stoppedEarly) lines.push(`Stopped early: ${stoppedEarly}.`, '');
    lines.push(`- Missed phrases: ${cell(phrases(summary.missedPhrases))}`);
    lines.push(`- Banned phrases: ${cell(phrases(summary.bannedHits))}`);
    lines.push(`- Scored after a max_tokens cut-off: ${summary.truncatedButScored}; generated tokens: ${summary.totalGenTokens}`, '');
    lines.push('| case | status | done | tokens | ms | missed | banned | note |', '|---|---|---|---|---|---|---|---|');
    for (const entry of cases) {
      lines.push(`| ${cell(entry.title)} | ${entry.status} | ${cell(entry.doneReason)} | ${cell(entry.genTokens)} | ${cell(entry.latencyMs === null ? null : Math.round(entry.latencyMs))} | ${cell(entry.failedTraits.join(', '))} | ${cell(entry.excludedHits.join(', '))} | ${cell(entry.error)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function writeReport(report, folder) {
  const stamp = report.startedAt.replace(/[:.]/g, '-');
  const base = join(folder, `eval-davellm-${stamp}`);
  // 'wx' never overwrites an earlier report.
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(`${base}.md`, `${renderMarkdown(report)}\n`, { flag: 'wx' });
  return { json: `${base}.json`, markdown: `${base}.md` };
}

export async function main(argv = process.argv.slice(2)) {
  assertSupportedNode();
  const options = parseCliArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return null;
  }
  const report = await runEval(options, { log: (line) => console.error(line) });
  const paths = writeReport(report, options.out || dirname(options.input));
  for (const model of report.models) {
    const s = report.results[model].summary;
    console.log(`${model}: ${s.pass} pass, ${s.fail} fail, ${s.invalid_json + s.no_enhanced + s.truncated + s.empty} unparsed, ${s.blocked} blocked, ${s.error} errors, pass rate ${percent(s.passRate)}`);
  }
  console.log(`Report: ${paths.markdown}`);
  return paths;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof EvalSetupError ? error.message : `eval-davellm failed: ${error.stack || error}`);
    process.exitCode = 1;
  });
}
