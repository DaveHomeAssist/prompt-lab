import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANON_KEY_ENV_NAMES,
  UNREACHABLE,
  WEBHOOK_URL,
  assertReadOnlySelect,
  expectedSyncSchema,
  formatReport,
  isUnreachable,
  readMigrationSchema,
  runSyncPreflight,
} from './sync-preflight.mjs';

const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const ORIGIN = 'https://abcd.supabase.co';
const CLERK_ENVIRONMENT = 'https://clerk.promptlab.tools/v1/environment';
const SENTINEL_KEY = 'sb_publishable_SENTINEL_VALUE';
const SENTINEL_SECRET = 'sb_secret_SENTINEL_VALUE';
const SENTINEL_WEBHOOK = 'whsec_SENTINEL_VALUE';
const SENTINEL_CLERK = 'sk_test_SENTINEL_VALUE';

function env(extra = {}) {
  return {
    VITE_SUPABASE_URL: ORIGIN,
    SUPABASE_URL: ORIGIN,
    VITE_SUPABASE_PUBLISHABLE_KEY: SENTINEL_KEY,
    SUPABASE_SECRET_KEY: SENTINEL_SECRET,
    CLERK_WEBHOOK_SIGNING_SECRET: SENTINEL_WEBHOOK,
    CLERK_SECRET_KEY: SENTINEL_CLERK,
    CLERK_JWT_ISSUER: 'https://clerk.promptlab.tools',
    VITE_PL_ACCOUNT_SYNC: 'on',
    ...extra,
  };
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function clerkEnvironment({ captcha = true, verifyEmail = true } = {}) {
  return jsonResponse(200, {
    user_settings: {
      sign_up: { captcha_enabled: captcha },
      attributes: { email_address: { verify_at_sign_up: verifyEmail } },
    },
  });
}

function noSecrets(report) {
  const text = formatReport(report);
  for (const secret of [SENTINEL_KEY, SENTINEL_SECRET, SENTINEL_WEBHOOK, SENTINEL_CLERK, ORIGIN]) {
    assert.equal(text.includes(secret), false, secret);
  }
  return text;
}

test('migration files name the sync tables, owner policies and forced RLS', () => {
  const schema = readMigrationSchema(migrationsDir);
  assert.deepEqual(schema.tables.sort(), [
    'public.sync_conflicts',
    'public.sync_items',
    'sync.accounts',
    'sync.egress',
    'sync.rate',
    'sync.settings',
  ]);
  assert.deepEqual(schema.policies.map((policy) => policy.name).sort(), ['sync_conflicts_owner_write', 'sync_items_owner_write']);
  assert.deepEqual(schema.forcedRls.sort(), ['public.sync_conflicts', 'public.sync_items']);
});

test('a query that is not a single select is refused before it can be sent', () => {
  assert.equal(assertReadOnlySelect('select 1'), 'select 1');
  assert.equal(assertReadOnlySelect('  SELECT schemaname from pg_policies;  '), 'SELECT schemaname from pg_policies');
  for (const sql of ['delete from public.sync_items', 'select 1; drop table public.sync_items', 'insert into sync.settings values (1)', 'update sync.settings set value = \'off\'']) {
    assert.throws(() => assertReadOnlySelect(sql), /not a select|more than one|not read-only/);
  }
});

test('paused and unreachable responses are recognized without treating an auth rejection as a pause', () => {
  assert.equal(isUnreachable(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })), true);
  assert.equal(isUnreachable(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), true);
  assert.equal(isUnreachable(null, { status: 540 }, ''), true);
  assert.equal(isUnreachable(null, { status: 401 }, '{"message":"Project paused"}'), true);
  assert.equal(isUnreachable(null, { status: 401 }, '{"message":"Invalid API key"}'), false);
});

test('missing env is a failing checklist and the values are never printed', async () => {
  const calls = [];
  const report = await runSyncPreflight({
    env: { VITE_SUPABASE_URL: 'https://evil.example.com/secret-path', VITE_SUPABASE_PUBLISHABLE_KEY: SENTINEL_KEY, VITE_PL_ACCOUNT_SYNC: SENTINEL_SECRET },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.equal(url, CLERK_ENVIRONMENT);
      return clerkEnvironment();
    },
    migrationsDir,
  });
  const text = formatReport(report);
  assert.deepEqual(calls.map(({ url }) => url), [CLERK_ENVIRONMENT]);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.headers.apikey, undefined);
  assert.match(text, /PASS {2}R5 {2}bot protection {2}enabled/);
  assert.match(text, /PASS {2}R5 {2}email verification {2}required at sign-up/);
  assert.match(text, /PASS {2}R6 {2}VITE_SUPABASE_URL {2}present/);
  assert.match(text, /PASS {2}R6 {2}anon key {2}present as VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(text, /FAIL {2}R6 {2}project url {2}VITE_SUPABASE_URL is not a project url/);
  assert.match(text, /FAIL {2}R6 {2}VITE_PL_ACCOUNT_SYNC=on {2}not on/);
  assert.match(text, /FAIL {2}R4 {2}CLERK_SECRET_KEY {2}absent/);
  assert.equal(text.includes(SENTINEL_KEY), false);
  assert.equal(text.includes(SENTINEL_SECRET), false);
  assert.equal(text.includes('evil.example.com'), false);
  assert.equal(report.exitCode, 1);
  assert.equal(text.includes(UNREACHABLE), false);
});

test('an unavailable Clerk endpoint fails R5 without reporting a Supabase pause', async () => {
  const report = await runSyncPreflight({
    env: {},
    fetchImpl: async (url) => {
      assert.equal(url, CLERK_ENVIRONMENT);
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    },
    migrationsDir,
  });
  assert.equal(report.unreachable, false);
  assert.deepEqual(
    report.results.filter((row) => row.id.startsWith('R5')).map(({ status, detail }) => [status, detail]),
    [['FAIL', 'Clerk Frontend API unreachable'], ['FAIL', 'Clerk Frontend API unreachable']],
  );
});

test('anon key presence accepts the publishable name or a legacy anon name', () => {
  assert.ok(ANON_KEY_ENV_NAMES.includes('VITE_SUPABASE_PUBLISHABLE_KEY'));
  assert.ok(ANON_KEY_ENV_NAMES.includes('SUPABASE_ANON_KEY'));
});

test('an unreachable Supabase project leaves the Clerk preflight active and sends no writes', async () => {
  const calls = [];
  const report = await runSyncPreflight({
    env: env(),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body, headers: init?.headers });
      if (url === CLERK_ENVIRONMENT) return clerkEnvironment();
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    },
    migrationsDir,
  });
  const text = noSecrets(report);
  assert.match(text, new RegExp(`^sync:preflight\\n${UNREACHABLE}`, 'm'));
  assert.equal(report.unreachable, true);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(calls.map(({ url }) => url), [ORIGIN + '/auth/v1/settings', CLERK_ENVIRONMENT]);
  assert.ok(calls.every(({ method, body }) => method === 'GET' && body === undefined));
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.equal(calls[1].headers.apikey, undefined);
  assert.match(text, /PASS {2}R5 {2}bot protection {2}enabled/);
  assert.match(text, /PASS {2}R5 {2}email verification {2}required at sign-up/);
  assert.match(text, /SKIP {2}schema {2}public.sync_items {2}project unreachable or paused/);
  assert.match(text, /SKIP {2}R3 {2}sign-ups off {2}project unreachable or paused/);
});

test('HTTP 540 is the same clean pause result and never sends a write', async () => {
  const methods = [];
  const report = await runSyncPreflight({
    env: env(),
    fetchImpl: async (url, init) => {
      methods.push(init?.method || 'GET');
      return url === CLERK_ENVIRONMENT ? clerkEnvironment() : jsonResponse(540, 'Project paused');
    },
    migrationsDir,
  });
  assert.deepEqual(methods, ['GET', 'GET']);
  assert.equal(report.exitCode, 0);
  assert.match(formatReport(report), new RegExp(UNREACHABLE));
  noSecrets(report);
});

test('a reachable project checks auth settings and tables with reads only', async () => {
  const calls = [];
  const report = await runSyncPreflight({
    env: env({ VITE_PL_ACCOUNT_SYNC: 'off' }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body, apikey: init?.headers?.apikey });
      const target = String(url);
      if (target.endsWith('/auth/v1/settings')) {
        return jsonResponse(200, { disable_signup: false, external: { anonymous_users: true } });
      }
      if (target.includes('/realtime/v1/')) return jsonResponse(404, '');
      if (target.includes('/rest/v1/sync_items')) return jsonResponse(401, { code: '42501', message: 'permission denied for table sync_items' });
      if (target.includes('/rest/v1/sync_conflicts')) return jsonResponse(404, { code: 'PGRST205', message: 'Could not find the table' });
      if (target.includes('api.clerk.com/v1/jwt_templates')) return jsonResponse(200, [{ name: 'supabase' }]);
      if (target === CLERK_ENVIRONMENT) return clerkEnvironment({ verifyEmail: false });
      if (target.includes('api.clerk.com/v1/webhooks')) {
        return jsonResponse(200, { data: [{ url: WEBHOOK_URL, events: ['user.deleted'] }] });
      }
      throw new Error(`unexpected ${target}`);
    },
    migrationsDir,
  });
  const text = noSecrets(report);
  assert.ok(calls.every((call) => call.method === 'GET' && call.body === undefined));
  assert.ok(calls.some((call) => call.url.endsWith('/auth/v1/settings') && call.apikey === SENTINEL_KEY));
  assert.match(text, /FAIL {2}R3 {2}sign-ups off {2}disable_signup is not true/);
  assert.match(text, /FAIL {2}R3 {2}anonymous sign-ins off/);
  assert.match(text, /PASS {2}R3 {2}Realtime off {2}realtime endpoint is absent/);
  assert.match(text, /PASS {2}schema {2}public.sync_items {2}present; anon select refused/);
  assert.match(text, /FAIL {2}schema {2}public.sync_conflicts {2}not in the API schema/);
  assert.match(text, /FAIL {2}schema {2}policy sync_items_owner_write {2}not queried; SUPABASE_ACCESS_TOKEN absent/);
  assert.match(text, /FAIL {2}R4 {2}no JWT template {2}a JWT template named for the database is present/);
  assert.match(text, /PASS {2}R5 {2}bot protection {2}enabled/);
  assert.match(text, /FAIL {2}R5 {2}email verification {2}not confirmed/);
  assert.match(text, /PASS {2}R7 {2}user.deleted endpoint {2}endpoint subscribed to user.deleted/);
  assert.match(text, /FAIL {2}R6 {2}VITE_PL_ACCOUNT_SYNC=on {2}not on/);
  assert.equal(report.exitCode, 1);
});

test('catalog selects confirm tables and owner policies and reject a write attempt from the script', async () => {
  const bodies = [];
  const report = await runSyncPreflight({
    env: env({ SUPABASE_ACCESS_TOKEN: 'sbp_SENTINEL_TOKEN' }),
    fetchImpl: async (url, init) => {
      const target = String(url);
      if (init?.body) bodies.push(JSON.parse(init.body).query);
      if (target.endsWith('/auth/v1/settings')) return jsonResponse(200, { disable_signup: true, external: { anonymous_users: false } });
      if (target.includes('/realtime/v1/')) return jsonResponse(404, '');
      if (target.includes('/rest/v1/')) return jsonResponse(401, { code: '42501', message: 'permission denied' });
      if (target.includes('/database/query') && init.body.includes('pg_class')) {
        return jsonResponse(200, [
          { schema: 'public', name: 'sync_items', rls_enabled: true, rls_forced: true },
          { schema: 'public', name: 'sync_conflicts', rls_enabled: true, rls_forced: true },
          { schema: 'sync', name: 'settings', rls_enabled: false, rls_forced: false },
          { schema: 'sync', name: 'rate', rls_enabled: false, rls_forced: false },
          { schema: 'sync', name: 'egress', rls_enabled: false, rls_forced: false },
          { schema: 'sync', name: 'accounts', rls_enabled: false, rls_forced: false },
        ]);
      }
      if (target.includes('/database/query')) {
        return jsonResponse(200, [
          { schemaname: 'public', tablename: 'sync_items', policyname: 'sync_items_owner_write', roles: '{sync_owner}' },
          { schemaname: 'public', tablename: 'sync_conflicts', policyname: 'sync_conflicts_owner_write', roles: '{sync_owner}' },
        ]);
      }
      if (target.includes('api.clerk.com/v1/jwt_templates')) return jsonResponse(200, []);
      if (target === CLERK_ENVIRONMENT) return clerkEnvironment();
      if (target.includes('api.clerk.com/v1/webhooks')) return jsonResponse(200, { data: [{ url: WEBHOOK_URL, events: ['user.deleted'] }] });
      throw new Error(`unexpected ${target}`);
    },
    migrationsDir,
  });
  assert.equal(bodies.length, 2);
  for (const sql of bodies) assert.equal(assertReadOnlySelect(sql), sql.trim().replace(/;\s*$/, ''));
  const text = formatReport(report);
  assert.equal(text.includes('sbp_SENTINEL_TOKEN'), false);
  assert.match(text, /PASS {2}schema {2}sync.settings {2}present/);
  assert.match(text, /PASS {2}schema {2}forced RLS public.sync_items {2}enabled and forced/);
  assert.match(text, /PASS {2}schema {2}policy sync_items_owner_write {2}on public.sync_items for sync_owner/);
  assert.match(text, /PASS {2}R3 {2}sign-ups off/);
  assert.match(text, /PASS {2}R5 {2}email verification {2}required at sign-up/);
  assert.match(text, /SKIP {2}R4 {2}provider domain {2}expected clerk.promptlab.tools; not visible to the anon key/);
  noSecrets(report);
});

test('schema parsing ignores comments that are not migrations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-preflight-'));
  writeFileSync(join(dir, '001.sql'), 'create table if not exists public.sync_items (id int);\ncreate policy sync_items_owner_write on public.sync_items for all to sync_owner using (true);\nalter table public.sync_items force row level security;\n');
  const schema = readMigrationSchema(dir);
  assert.deepEqual(schema.tables, ['public.sync_items']);
  assert.equal(schema.policies[0].name, 'sync_items_owner_write');
  assert.deepEqual(schema.forcedRls, ['public.sync_items']);
});
