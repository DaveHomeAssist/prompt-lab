import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UNREACHABLE,
  assertReadOnlySelect,
  expectedSyncSchema,
  formatReport,
  isUnreachable,
  readMigrationSchema,
  runSyncPreflight,
} from './sync-preflight.mjs';

const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const ORIGIN = 'https://abcd.supabase.co';
const MANAGEMENT_API = 'https://api.supabase.com/v1/projects/abcd';
const CLERK_ENVIRONMENT = 'https://clerk.promptlab.tools/v1/environment';
const CLERK_TEMPLATES = 'https://api.clerk.com/v1/jwt_templates';
const SENTINEL_MANAGEMENT = 'sbp_SENTINEL_TOKEN';
const schema = readMigrationSchema(migrationsDir);
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
    VITE_PL_ACCOUNT_SYNC: 'off',
    SUPABASE_ACCESS_TOKEN: SENTINEL_MANAGEMENT,
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
  for (const secret of [SENTINEL_KEY, SENTINEL_SECRET, SENTINEL_WEBHOOK, SENTINEL_CLERK, SENTINEL_MANAGEMENT, ORIGIN]) {
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

function validProviderResponse(url, init) {
  if (url === ORIGIN + '/auth/v1/settings') return jsonResponse(200, {});
  if (url.startsWith(ORIGIN + '/rest/v1/')) return jsonResponse(401, { code: '42501' });
  if (url === MANAGEMENT_API + '/database/migrations') {
    return jsonResponse(200, schema.versions.map((version) => ({ version })));
  }
  if (url === MANAGEMENT_API + '/config/auth') {
    return jsonResponse(200, { disable_signup: true, external_anonymous_users_enabled: false });
  }
  if (url === MANAGEMENT_API + '/config/realtime') return jsonResponse(200, { suspend: true });
  if (url === MANAGEMENT_API + '/config/auth/third-party-auth') {
    return jsonResponse(200, [{ oidc_issuer_url: 'https://clerk.promptlab.tools/' }]);
  }
  if (url === MANAGEMENT_API + '/database/query') {
    const sql = JSON.parse(init.body).query;
    if (sql.includes('pg_catalog.pg_class')) {
      return jsonResponse(201, schema.tables.map((qualified) => {
        const [schemaName, name] = qualified.split('.');
        const forced = schema.forcedRls.includes(qualified);
        return { schema: schemaName, name, rls_enabled: forced, rls_forced: forced };
      }));
    }
    if (sql.includes('pg_catalog.pg_policies')) {
      return jsonResponse(201, schema.policies.map(({ name, table }) => {
        const [schemaname, tablename] = table.split('.');
        return { policyname: name, schemaname, tablename, roles: '{sync_owner}' };
      }));
    }
  }
  if (url === CLERK_ENVIRONMENT) return clerkEnvironment();
  if (url === CLERK_TEMPLATES) return jsonResponse(200, []);
  throw new Error(`unexpected request: ${url}`);
}

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
    expectEnabled: true,
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
  assert.match(text, /PASS {2}R6 {2}VITE_SUPABASE_PUBLISHABLE_KEY {2}present/);
  assert.match(text, /FAIL {2}R6 {2}project url {2}matching Supabase project URLs required/);
  assert.match(text, /FAIL {2}R6 {2}VITE_PL_ACCOUNT_SYNC {2}must be on for acceptance/);
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

test('a legacy alias cannot satisfy the browser key requirement', async () => {
  const report = await runSyncPreflight({
    env: env({ VITE_SUPABASE_PUBLISHABLE_KEY: undefined, SUPABASE_ANON_KEY: SENTINEL_KEY }),
    fetchImpl: validProviderResponse,
    migrationsDir,
  });
  assert.equal(report.exitCode, 1);
  assert.match(noSecrets(report), /FAIL {2}R6 {2}VITE_SUPABASE_PUBLISHABLE_KEY {2}absent/);
});

for (const [description, unavailable] of [
  ['DNS failure', () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); }],
  ['HTTP 540', () => jsonResponse(540, 'Project paused')],
]) {
  test(`${description} prevents a pass and leaves both Clerk checks active`, async () => {
    const calls = [];
    const report = await runSyncPreflight({
      env: env(),
      fetchImpl: async (url, init) => {
        calls.push({ url, method: init.method, body: init.body, headers: init.headers });
        if (url.startsWith(ORIGIN)) return unavailable();
        return validProviderResponse(url, init);
      },
      migrationsDir,
    });
    const text = noSecrets(report);
    assert.deepEqual(calls.map(({ url }) => url), [ORIGIN + '/auth/v1/settings', CLERK_ENVIRONMENT, CLERK_TEMPLATES]);
    assert.ok(calls.every(({ method, body }) => method === 'GET' && body === undefined));
    assert.equal(calls[1].headers.Authorization, undefined);
    assert.equal(calls[1].headers.apikey, undefined);
    assert.equal(report.unreachable, true);
    assert.equal(report.exitCode, 2);
    assert.match(text, /PASS {2}R6 {2}VITE_PL_ACCOUNT_SYNC {2}disabled for preactivation/);
    assert.match(text, /PASS {2}R5 {2}bot protection {2}enabled/);
    assert.match(text, /PASS {2}R5 {2}email verification {2}required at sign-up/);
    assert.match(text, /PASS {2}R4 {2}no JWT template/);
    assert.ok(text.includes(UNREACHABLE));
    assert.match(text, /SKIP {2}R2 {2}migration history {2}project unreachable or paused/);
    assert.doesNotMatch(text, /Automated checks passed/);
  });
}

test('preactivation expects a disabled flag and the enabled mode is explicit', async () => {
  for (const [flag, expectEnabled, expected] of [
    [undefined, false, 0],
    ['off', false, 0],
    ['on', false, 1],
    ['ON', true, 0],
    ['off', true, 1],
  ]) {
    const report = await runSyncPreflight({
      env: env({ VITE_PL_ACCOUNT_SYNC: flag }),
      expectEnabled,
      fetchImpl: validProviderResponse,
      migrationsDir,
    });
    assert.equal(report.exitCode, expected, `flag=${flag}, enabled mode=${expectEnabled}`);
  }
});

test('preactivation confirms the documented Management API settings and read-only catalog checks', async () => {
  const calls = [];
  const report = await runSyncPreflight({
    env: env({ VITE_SUPABASE_URL: ORIGIN + '/' }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return validProviderResponse(url, init);
    },
    migrationsDir,
  });
  const queries = calls.filter(({ init }) => init.method !== 'GET');
  assert.equal(queries.length, 2);
  for (const { url, init } of queries) {
    assert.equal(url, MANAGEMENT_API + '/database/query');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.read_only, true);
    assert.equal(assertReadOnlySelect(body.query), body.query);
  }
  assert.ok(calls.filter(({ url }) => url.startsWith(MANAGEMENT_API)).every(({ init }) => init.headers.Authorization === 'Bearer ' + SENTINEL_MANAGEMENT));
  assert.ok(calls.filter(({ url }) => url.startsWith(ORIGIN)).every(({ init }) => init.headers.apikey === SENTINEL_KEY && init.headers.Authorization === undefined));
  assert.equal(report.exitCode, 0);
  const text = noSecrets(report);
  for (const id of [
    'R2  migration history',
    'R3  sign-ups off',
    'R3  anonymous sign-ins off',
    'R3  Realtime off',
    'R4  provider domain',
    'R5  email verification',
    'R6  publishable key accepted',
    'schema  anon access public.sync_items',
    'schema  sync.settings',
    'schema  forced RLS public.sync_items',
    'schema  policy sync_items_owner_write',
  ]) assert.ok(text.includes(`PASS  ${id}`), id);
  assert.match(text, /MANUAL {2}R4 {2}session role/);
  assert.match(text, /MANUAL {2}R7 {2}user.deleted endpoint/);
  assert.match(text, /Complete the manual checks before release/);
  assert.ok(calls.every(({ url }) => !url.includes('/webhooks')));
});

test('migration drift and unverified managed settings prevent rollout', async () => {
  const missing = '20261117125000';
  assert.ok(schema.versions.includes(missing));
  const report = await runSyncPreflight({
    env: env(),
    fetchImpl: async (url, init) => {
      if (url === MANAGEMENT_API + '/database/migrations') {
        return jsonResponse(200, schema.versions.filter((version) => version !== missing)
          .concat('19990101000000').map((version) => ({ version })));
      }
      if (url === MANAGEMENT_API + '/config/auth') {
        return jsonResponse(200, { disable_signup: false });
      }
      if (url === MANAGEMENT_API + '/config/realtime') return jsonResponse(200, { suspend: false });
      if (url === MANAGEMENT_API + '/config/auth/third-party-auth') {
        return jsonResponse(200, [{ oidc_issuer_url: 'https://example.test' }]);
      }
      if (url === CLERK_ENVIRONMENT) return clerkEnvironment({ verifyEmail: false });
      if (url === CLERK_TEMPLATES) return jsonResponse(404, []);
      return validProviderResponse(url, init);
    },
    migrationsDir,
  });
  const text = noSecrets(report);
  assert.equal(report.exitCode, 1);
  assert.match(text, /FAIL {2}R2 {2}migration history {2}missing versions: 20261117125000.*Unexpected version count: 1/);
  assert.match(text, /FAIL {2}R3 {2}sign-ups off/);
  assert.match(text, /FAIL {2}R3 {2}anonymous sign-ins off/);
  assert.match(text, /FAIL {2}R3 {2}Realtime off/);
  assert.match(text, /FAIL {2}R4 {2}provider domain/);
  assert.match(text, /FAIL {2}R4 {2}no JWT template {2}Clerk JWT templates HTTP 404/);
  assert.match(text, /FAIL {2}R5 {2}email verification/);
  assert.doesNotMatch(text, /example.test|19990101000000/);
});

test('catalog success cannot hide a readable table or a rejected key', async () => {
  const report = await runSyncPreflight({
    env: env(),
    fetchImpl: async (url, init) => {
      if (url.includes('/rest/v1/sync_items')) return jsonResponse(200, []);
      if (url.includes('/rest/v1/sync_conflicts')) return jsonResponse(401, { message: 'Invalid API key' });
      return validProviderResponse(url, init);
    },
    migrationsDir,
  });
  const text = noSecrets(report);
  assert.equal(report.exitCode, 1);
  assert.match(text, /FAIL {2}schema {2}anon access public.sync_items .*HTTP 200/);
  assert.match(text, /FAIL {2}schema {2}anon access public.sync_conflicts .*HTTP 401/);
  assert.match(text, /PASS {2}schema {2}public.sync_items {2}present/);
  assert.match(text, /PASS {2}schema {2}forced RLS public.sync_items/);
});

test('schema parsing ignores comments that are not migrations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-preflight-'));
  writeFileSync(join(dir, '001.sql'), 'create table if not exists public.sync_items (id int);\ncreate policy sync_items_owner_write on public.sync_items for all to sync_owner using (true);\nalter table public.sync_items force row level security;\n');
  const schema = readMigrationSchema(dir);
  assert.deepEqual(schema.tables, ['public.sync_items']);
  assert.equal(schema.policies[0].name, 'sync_items_owner_write');
  assert.deepEqual(schema.forcedRls, ['public.sync_items']);
});
