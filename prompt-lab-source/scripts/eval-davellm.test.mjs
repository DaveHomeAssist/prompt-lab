import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ALL_TAGS, buildSystemPrompt, MODES } from '../prompt-lab-extension/src/constants.js';
import { checkTraits } from '../prompt-lab-extension/src/promptUtils.js';
import {
  buildAppPayload,
  classifyReply,
  DEFAULT_CASE_LIMIT,
  DEFAULT_ROUTER,
  EvalSetupError,
  JSON_CONSTRAINED_NOTE,
  loadCases,
  parseCliArgs,
  renderMarkdown,
  runEval,
  writeReport,
} from './eval-davellm.mjs';

const KEY = 'fixture-only-key';
const reply = (response, extra = {}) => ({
  response, node: 'Walter', node_id: 'walter', done_reason: 'stop',
  stats: { gen_tokens: 40, gen_tps: 80 }, latency_ms: 500, ...extra,
});
// Canned models standing in for real ones; each answers every case the same way.
const MODELS = {
  good: () => reply(JSON.stringify({ enhanced: 'Be concise. State the task and the audience.' })),
  weak: () => reply(JSON.stringify({ enhanced: 'As an AI, I add filler to the task.' })),
  prose: () => reply('Here is your improved prompt: be concise.'),
  'no-enhanced': () => reply('{"improved":"be concise"}'),
  long: () => reply('{"enhanced":"Be conc', { done_reason: 'length', stats: { gen_tokens: 4096, gen_tps: 75 } }),
  'cut-after-enhanced': () => reply('{"enhanced":"Be concise about the task.","variants":["a', { done_reason: 'length' }),
  silent: () => reply('', { reason: 'tool_call_only', notice: 'tool call only', tools: ['browser.run'] }),
  down: () => ({ status: 503, body: { detail: "Cannot connect to node 'Walter'" } }),
};

function startRouter() {
  const calls = [];
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const send = (status, body) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (request.headers['x-api-key'] !== KEY) return send(401, { detail: 'Invalid API key' });
      if (request.method === 'GET' && request.url === '/nodes') return send(200, [{ id: 'walter', name: 'Walter' }]);
      if (request.method === 'GET' && request.url === '/nodes/walter/models') {
        return send(200, { node_id: 'walter', models: Object.keys(MODELS).map((id) => ({ id })), error: null });
      }
      if (request.method === 'POST' && request.url === '/eval/chat') {
        const body = JSON.parse(raw);
        calls.push(body);
        const result = MODELS[body.model]();
        return result.status ? send(result.status, result.body) : send(200, { ...result, model: body.model });
      }
      return send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolveStart) => {
    server.listen(0, '127.0.0.1', () => resolveStart({ server, calls, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const CASES = [
  { id: 'c1', promptId: 'p1', title: 'Tighten a request', input: 'make this better', expectedTraits: ['concise', 'task'], expectedExclusions: ['filler'] },
  { id: 'c2', promptId: 'p1', title: 'Has contact details', input: 'email me at someone@example.com or call 555-123-4567', expectedTraits: ['concise'] },
  { id: 'c3', promptId: 'p2', title: 'No expectations', input: 'summarize the meeting' },
  { id: 'c4', promptId: 'p2', title: 'Audience', input: 'write release notes', expectedTraits: ['/audience|reader/'], expectedExclusions: ['As an AI'] },
];

describe('eval-davellm', () => {
  let router;
  let folder;
  let input;

  before(async () => {
    router = await startRouter();
    folder = mkdtempSync(join(tmpdir(), 'eval-davellm-'));
    input = join(folder, 'workspace.json');
    writeFileSync(input, JSON.stringify({ version: '1.7.1', library: [{ id: 'p1', title: 'Rewrite' }, { id: 'p2', title: 'Notes' }], testCases: CASES }));
  });
  after(() => router.server.close());

  const options = (overrides = {}) => ({
    ...parseCliArgs(['--input', input, '--node', 'walter', '--models', 'good', '--router', router.url], { DAVE_API_KEY: KEY }),
    ...overrides,
  });

  it('defaults to the D-EVAL-04 A shape and the D-EVAL-05 A json format', () => {
    const parsed = parseCliArgs(['--input', 'w.json', '--node', 'walter', '--models', 'a, b'], { DAVE_API_KEY: KEY });
    assert.equal(parsed.caseLimit, DEFAULT_CASE_LIMIT);
    assert.equal(parsed.caseLimit, 10);
    assert.equal(parsed.maxTokens, 4096);
    assert.equal(parsed.format, 'json');
    assert.equal(parsed.router, DEFAULT_ROUTER);
    assert.deepEqual(parsed.models, ['a', 'b']);
    assert.equal(parseCliArgs(['--input', 'w.json', '--node', 'n', '--models', 'a', '--no-format'], { DAVE_API_KEY: KEY }).format, null);
    assert.throws(() => parseCliArgs(['--input', 'w.json', '--node', 'n', '--models', 'a'], {}), /DAVE_API_KEY/);
    assert.throws(() => parseCliArgs(['--input', 'w.json', '--node', 'n', '--models', 'a', '--cases', '0'], { DAVE_API_KEY: KEY }), /positive integer/);
  });

  it('accepts only enhance modes the app defines, since an unknown one silently runs balanced', () => {
    const args = (mode) => ['--input', 'w.json', '--node', 'n', '--models', 'a', '--mode', mode];
    for (const { id } of MODES) assert.equal(parseCliArgs(args(id), { DAVE_API_KEY: KEY }).mode, id);
    assert.throws(() => parseCliArgs(args('balance'), { DAVE_API_KEY: KEY }), (error) => error instanceof EvalSetupError
      && /Unknown --mode "balance"/.test(error.message) && error.message.includes(MODES.map(({ id }) => id).join(', ')));
  });

  it('builds the payload the app builds for a Library Test', () => {
    const payload = buildAppPayload('make this better');
    assert.equal(payload.system, buildSystemPrompt('balanced', ALL_TAGS));
    assert.equal(payload.max_tokens, 4096);
    assert.equal(payload.temperature, 0.4);
    assert.equal(payload.responseFormat, 'json');
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'make this better' }]);
  });

  it('keeps every unscorable reply in its own column, pinned to the app parser', () => {
    assert.equal(classifyReply(reply('')).outcome, 'empty');
    assert.equal(classifyReply(reply('plain prose')).outcome, 'invalid_json');
    assert.equal(classifyReply(reply('{"x":1}')).outcome, 'no_enhanced');
    assert.equal(classifyReply(reply('{"enhanced":"Be', { done_reason: 'length' })).outcome, 'truncated');
    assert.equal(classifyReply(reply('', { reason: 'tool_call_only' })).outcome, 'tool_call_only');
    const recovered = classifyReply(reply('{"enhanced":"done","variants":["a', { done_reason: 'length' }));
    assert.deepEqual([recovered.outcome, recovered.enhanced, recovered.truncated], ['parsed', 'done', true]);
  });

  it('selects cases by limit or id and normalizes them like the app', () => {
    assert.deepEqual(loadCases({ testCases: CASES }, { caseLimit: 2 }).map((c) => c.id), ['c1', 'c2']);
    assert.deepEqual(loadCases(CASES, { caseIds: ['c4', 'c1'] }).map((c) => c.id), ['c4', 'c1']);
    assert.equal(loadCases({ library: [{ id: 'p1', title: 'Rewrite' }], testCases: CASES })[0].promptTitle, 'Rewrite');
    assert.throws(() => loadCases(CASES, { caseIds: ['nope'] }), /Unknown case ids: nope/);
    assert.throws(() => loadCases({ prompts: [] }), EvalSetupError);
  });

  it('sends json-constrained Enhance requests, gates PII, and scores with checkTraits', async () => {
    router.calls.length = 0;
    const report = await runEval(options({ models: ['good', 'weak'] }));
    // c2 carries an email address and phone number: blocked before any send, for both models.
    assert.equal(router.calls.length, 6);
    for (const call of router.calls) {
      assert.equal(call.format, 'json');
      assert.equal(call.node_id, 'walter');
      assert.equal(call.max_tokens, 4096);
      assert.equal(call.temperature, 0.4);
      assert.deepEqual(call.messages[0], { role: 'system', content: buildSystemPrompt('balanced', ALL_TAGS) });
      assert.equal(call.messages[1].role, 'user');
      assert.ok(!call.messages.some((message) => message.content.includes('someone@example.com')));
    }
    for (const model of ['good', 'weak']) {
      const enhanced = JSON.parse(MODELS[model]().response).enhanced;
      for (const record of report.results[model].cases.filter((entry) => entry.sent)) {
        const testCase = CASES.find((entry) => entry.id === record.caseId);
        // Acceptance: the runner's verdict is the one the app's own checkTraits records.
        assert.equal(record.verdict, checkTraits(enhanced, testCase.expectedTraits, testCase.expectedExclusions).verdict);
      }
    }
    const good = report.results.good.summary;
    assert.deepEqual([good.pass, good.fail, good.unscored, good.blocked, good.sent], [2, 0, 1, 1, 3]);
    assert.equal(good.passRate, 1);
    const weak = report.results.weak.summary;
    assert.deepEqual([weak.pass, weak.fail, weak.blocked], [0, 2, 1]);
    assert.deepEqual(weak.missedPhrases, [['concise', 1], ['/audience|reader/', 1]]);
    assert.deepEqual(weak.bannedHits, [['filler', 1], ['As an AI', 1]]);
    assert.equal(report.jsonConstrained, true);
  });

  it('omits format when asked (D-EVAL-05 B) and drops the constrained note', async () => {
    router.calls.length = 0;
    const report = await runEval(options({ format: null, caseIds: ['c1'] }));
    assert.equal(router.calls.length, 1);
    assert.ok(!('format' in router.calls[0]));
    assert.ok(!renderMarkdown(report).includes(JSON_CONSTRAINED_NOTE));
  });

  it('counts invalid JSON, missing enhanced and tool-call-only replies apart', async () => {
    const report = await runEval(options({ models: ['prose', 'no-enhanced', 'cut-after-enhanced'], caseIds: ['c1', 'c4'] }));
    assert.equal(report.results.prose.summary.invalid_json, 2);
    assert.equal(report.results['no-enhanced'].summary.no_enhanced, 2);
    const cut = report.results['cut-after-enhanced'];
    // The parser recovered a complete enhanced string from a cut-off reply: scored and flagged,
    // and the stop rule still ends the pass because the first case used the whole budget.
    assert.deepEqual([cut.summary.pass, cut.summary.truncatedButScored, cut.summary.truncated], [1, 1, 0]);
    assert.equal(cut.cases[0].doneReason, 'length');
    assert.equal(cut.stoppedEarly, 'the first case ran out of max_tokens');
  });

  it('stops a model whose first case runs out of max_tokens or returns nothing', async () => {
    router.calls.length = 0;
    const report = await runEval(options({ models: ['long', 'silent'] }));
    assert.equal(router.calls.filter((call) => call.model === 'long').length, 1);
    assert.equal(router.calls.filter((call) => call.model === 'silent').length, 1);
    const long = report.results.long;
    assert.equal(long.stoppedEarly, 'the first case ran out of max_tokens');
    // Every later case is skipped unattempted, the PII case included.
    assert.deepEqual([long.summary.truncated, long.summary.skipped, long.summary.blocked], [1, 3, 0]);
    assert.equal(report.results.silent.summary.tool_call_only, 1);
    assert.equal(report.results.silent.stoppedEarly, 'the first case returned no content');
  });

  it('stops a model when the router cannot reach the node', async () => {
    router.calls.length = 0;
    const report = await runEval(options({ models: ['down', 'good'], caseIds: ['c1', 'c3', 'c4'] }));
    assert.equal(report.results.down.summary.error, 1);
    assert.equal(report.results.down.summary.skipped, 2);
    assert.match(report.results.down.cases[0].error, /HTTP 503/);
    assert.equal(report.results.good.summary.sent, 3);
  });

  it('refuses before any model call on a wrong key or a model outside the inventory', async () => {
    router.calls.length = 0;
    await assert.rejects(runEval(options({ apiKey: 'wrong' })), /refused the API key \(HTTP 401\)/);
    await assert.rejects(runEval(options({ models: ['good', 'missing-model'] })), /Not in walter's inventory: missing-model/);
    await assert.rejects(runEval(options({ node: 'duncan' })), /Node 'duncan' is not configured/);
    await assert.rejects(runEval(options({ router: 'http://127.0.0.1:9' })), /Cannot reach DaveLLM/);
    assert.equal(router.calls.length, 0);
  });

  it('dry run checks inventory and the PII gate without calling a model', async () => {
    router.calls.length = 0;
    const report = await runEval(options({ dryRun: true }));
    assert.equal(router.calls.length, 0);
    assert.deepEqual([report.results.good.summary.dry_run, report.results.good.summary.blocked], [3, 1]);
    assert.match(renderMarkdown(report), /dry run, no model was called/);
  });

  it('writes json and markdown reports without overwriting', async () => {
    const report = await runEval(options({ caseIds: ['c1'] }));
    const paths = writeReport(report, folder);
    const markdown = readFileSync(paths.markdown, 'utf8');
    assert.ok(markdown.includes(JSON_CONSTRAINED_NOTE));
    assert.match(markdown, /\| good \| 1 \| 1 \| 0 \|/);
    assert.equal(JSON.parse(readFileSync(paths.json, 'utf8')).results.good.summary.pass, 1);
    assert.throws(() => writeReport(report, folder), /EEXIST/);
  });
});
