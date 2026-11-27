#!/usr/bin/env node
// Read-only rollout check for account Library sync (docs/ACCOUNT_SYNC_DESIGN.md
// steps R2–R7). Prints automated results and the remaining dashboard checks.
// Uses GETs and read-only catalog SELECTs. Env values are never printed.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UNREACHABLE = 'project unreachable or paused';
export const CLERK_DOMAIN = 'clerk.promptlab.tools';
export const CLERK_ISSUER = `https://${CLERK_DOMAIN}`;
const APP_ORIGIN = 'https://promptlab.tools';
const PROJECT_URL = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/;
const PROBE_MS = 8000;

const URL_ENV_NAMES = ['VITE_SUPABASE_URL', 'SUPABASE_URL'];
const PUBLISHABLE_KEY_ENV = 'VITE_SUPABASE_PUBLISHABLE_KEY';

const MUTATING = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|execute|merge|vacuum|reindex|cluster|lock|refresh|comment|do)\b/i;

export function present(env, name) {
  return typeof env?.[name] === 'string' && env[name].trim() !== '';
}

/** One SELECT, nothing else. Rejects every other statement before it is sent. */
export function assertReadOnlySelect(sql) {
  const text = String(sql || '').trim().replace(/;\s*$/, '');
  if (!/^select\b/i.test(text)) throw new Error('preflight query is not a select');
  if (text.includes(';')) throw new Error('preflight query has more than one statement');
  if (MUTATING.test(text)) throw new Error('preflight query is not read-only');
  return text;
}

export function expectedSyncSchema(sqlText) {
  const tables = [];
  const policies = [];
  const forced = [];
  for (const match of String(sqlText).matchAll(/create table if not exists\s+((?:public|sync)\.[a-z0-9_]+)/gi)) {
    tables.push(match[1].toLowerCase());
  }
  for (const match of String(sqlText).matchAll(/create policy\s+([a-z0-9_]+)\s+on\s+((?:public|sync)\.[a-z0-9_]+)/gi)) {
    policies.push({ name: match[1], table: match[2].toLowerCase() });
  }
  for (const match of String(sqlText).matchAll(/alter table\s+((?:public|sync)\.[a-z0-9_]+)\s+force row level security/gi)) {
    forced.push(match[1].toLowerCase());
  }
  return {
    tables: [...new Set(tables)],
    policies,
    forcedRls: [...new Set(forced)],
  };
}

export function readMigrationSchema(migrationsDir) {
  const directory = migrationsDir instanceof URL ? fileURLToPath(migrationsDir) : migrationsDir;
  const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  const versions = files.map((name) => name.match(/^(\d+)(?:_.+)?\.sql$/)?.[1]);
  if (!versions.length || versions.some((version) => !version) || new Set(versions).size !== versions.length) {
    throw new Error('migration filenames must have unique versions');
  }
  return {
    ...expectedSyncSchema(files.map((name) => readFileSync(join(directory, name), 'utf8')).join('\n')),
    versions,
  };
}

export function isUnreachable(error, response, body = '') {
  if (response && (response.status === 540 || response.status === 521 || response.status === 522)) return true;
  const text = `${body || ''}`;
  if (/project (is )?paused|paused project/i.test(text)) return true;
  if (!error) return false;
  const code = `${error.cause?.code || error.code || ''} ${error.name || ''} ${error.message || ''}`;
  return /AbortError|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR|fetch failed|getaddrinfo|timed out|network/i.test(code);
}

function redact(text, secrets) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out.replace(/https?:\/\/\S+/g, '[url]');
}

function line(status, id, detail) {
  return { status, id, detail };
}

async function request(url, { method = 'GET', headers, body, fetchImpl, timeoutMs, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function responseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function catalogRows(result) {
  const payload = result?.response.ok ? responseJson(result.text) : null;
  const rows = Array.isArray(payload) ? payload : payload?.result;
  return Array.isArray(rows) ? rows : null;
}

export async function runSyncPreflight({
  env = process.env,
  fetchImpl = globalThis.fetch,
  migrationsDir,
  timeoutMs = PROBE_MS,
  expectEnabled = false,
} = {}) {
  const schema = readMigrationSchema(migrationsDir);
  const secrets = Object.values(env).filter((value) => typeof value === 'string' && value.length >= 4);
  const results = [];
  const note = (status, id, detail) => {
    const clean = redact(detail, secrets);
    const existing = results.find((row) => row.id === id);
    if (existing) {
      existing.status = status;
      existing.detail = clean;
      return existing;
    }
    const row = line(status, id, clean);
    results.push(row);
    return row;
  };

  const [browserUrl, serverUrl] = URL_ENV_NAMES.map((name) => String(env[name] || '').replace(/\/+$/, ''));
  const projectRef = PROJECT_URL.exec(browserUrl)?.[1];
  const matchingUrls = Boolean(projectRef && browserUrl === serverUrl);
  const keyPresent = present(env, PUBLISHABLE_KEY_ENV);
  const flagOn = String(env.VITE_PL_ACCOUNT_SYNC || '').toLowerCase() === 'on';

  for (const name of [...URL_ENV_NAMES, PUBLISHABLE_KEY_ENV, 'SUPABASE_SECRET_KEY', 'CLERK_WEBHOOK_SIGNING_SECRET']) {
    note(present(env, name) ? 'PASS' : 'FAIL', `R6  ${name}`, present(env, name) ? 'present' : 'absent');
  }
  const flagDetail = expectEnabled
    ? (flagOn ? 'enabled for acceptance' : 'must be on for acceptance')
    : (flagOn ? 'must stay off until activation' : 'disabled for preactivation');
  note(flagOn === expectEnabled ? 'PASS' : 'FAIL', 'R6  VITE_PL_ACCOUNT_SYNC', flagDetail);
  note(matchingUrls ? 'PASS' : 'FAIL', 'R6  project url', matchingUrls ? 'browser and server target the same project' : 'matching Supabase project URLs required');

  const clerkKeyPresent = present(env, 'CLERK_SECRET_KEY');
  note(clerkKeyPresent ? 'PASS' : 'FAIL', 'R4  CLERK_SECRET_KEY', clerkKeyPresent ? 'present' : 'absent');

  const publicTables = schema.tables.filter((name) => name.startsWith('public.'));
  const supabaseChecks = [
    'R2  migration history',
    'R3  sign-ups off',
    'R3  anonymous sign-ins off',
    'R3  Realtime off',
    'R4  provider domain',
    'R6  publishable key accepted',
    ...publicTables.map((name) => `schema  anon access ${name}`),
    ...schema.tables.map((name) => `schema  ${name}`),
    ...schema.policies.map(({ name }) => `schema  policy ${name}`),
    ...schema.forcedRls.map((name) => `schema  forced RLS ${name}`),
  ];
  let unreachable = false;
  const probe = async (url, options) => {
    if (unreachable) return null;
    try {
      const result = await request(url, { ...options, fetchImpl, timeoutMs });
      unreachable = isUnreachable(null, result.response, result.text);
      return unreachable ? null : result;
    } catch (error) {
      if (!isUnreachable(error)) throw error;
      unreachable = true;
      return null;
    }
  };

  if (matchingUrls && keyPresent) {
    const headers = { apikey: env[PUBLISHABLE_KEY_ENV], Accept: 'application/json' };
    const auth = await probe(browserUrl + '/auth/v1/settings', { headers });
    if (auth) {
      const settings = responseJson(auth.text);
      const accepted = auth.response.ok && settings !== null && typeof settings === 'object' && !Array.isArray(settings);
      note(accepted ? 'PASS' : 'FAIL', 'R6  publishable key accepted', accepted ? 'accepted by the project' : `Auth settings HTTP ${auth.response.status} or invalid response`);
    }
    for (const name of publicTables) {
      const rel = name.slice('public.'.length);
      const checked = await probe(`${browserUrl}/rest/v1/${rel}?select=user_id&limit=0`, { headers });
      if (!checked) break;
      const { response, text } = checked;
      const code = responseJson(text)?.code;
      const denied = ([401, 403].includes(response.status) && code === '42501')
        || (response.status === 404 && code === 'PGRST205');
      note(denied ? 'PASS' : 'FAIL', `schema  anon access ${name}`, denied ? 'anon select refused' : `anon select denial not confirmed (HTTP ${response.status})`);
    }
  }

  const managementToken = present(env, 'SUPABASE_ACCESS_TOKEN');
  if (matchingUrls && managementToken && !unreachable) {
    const management = `https://api.supabase.com/v1/projects/${projectRef}`;
    const headers = { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN.trim()}`, Accept: 'application/json' };
    const get = (path) => probe(management + path, { headers });
    const check = (result, id, ok, success, failure) => {
      if (!result) return;
      if (!result.response.ok) {
        note('FAIL', id, `management API HTTP ${result.response.status}`);
        return;
      }
      const confirmed = ok(responseJson(result.text));
      note(confirmed ? 'PASS' : 'FAIL', id, confirmed ? success : failure);
    };

    const history = await get('/database/migrations');
    if (history?.response.ok) {
      const rows = responseJson(history.text);
      if (Array.isArray(rows) && rows.every((entry) => typeof entry?.version === 'string')) {
        const applied = new Set(rows.map(({ version }) => version));
        const expected = new Set(schema.versions);
        const missing = schema.versions.filter((version) => !applied.has(version));
        const extra = [...applied].filter((version) => !expected.has(version));
        const matches = missing.length === 0 && extra.length === 0;
        const detail = matches
          ? `all ${expected.size} repository versions recorded`
          : `missing versions: ${missing.join(', ') || 'none'}. Unexpected version count: ${extra.length}`;
        note(matches ? 'PASS' : 'FAIL', 'R2  migration history', detail);
      } else {
        note('FAIL', 'R2  migration history', 'invalid migration history response');
      }
    } else if (history) {
      note('FAIL', 'R2  migration history', `management API HTTP ${history.response.status}`);
    }

    const auth = await get('/config/auth');
    check(auth, 'R3  sign-ups off', (data) => data?.disable_signup === true, 'sign-ups disabled', 'sign-ups not confirmed disabled');
    check(auth, 'R3  anonymous sign-ins off', (data) => data?.external_anonymous_users_enabled === false, 'anonymous sign-ins disabled', 'anonymous sign-ins not confirmed disabled');
    check(await get('/config/realtime'), 'R3  Realtime off', (data) => data?.suspend === true, 'Realtime suspended', 'Realtime not confirmed suspended');
    check(await get('/config/auth/third-party-auth'), 'R4  provider domain',
      (data) => Array.isArray(data) && data.some((row) => [CLERK_ISSUER, `${CLERK_ISSUER}/`].includes(row?.oidc_issuer_url)),
      'production Clerk issuer registered', 'production Clerk issuer not confirmed');

    const query = (sql) => probe(management + '/database/query', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: assertReadOnlySelect(sql), read_only: true }),
    });
    const tableResponse = await query(`
      select n.nspname as schema, c.relname as name,
             c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and ((n.nspname = 'public' and c.relname in ('sync_items', 'sync_conflicts'))
          or (n.nspname = 'sync' and c.relname in ('settings', 'rate', 'egress', 'accounts')))
    `);
    const policyResponse = await query(`
      select schemaname, tablename, policyname, roles::text as roles
      from pg_catalog.pg_policies
      where schemaname = 'public' and tablename in ('sync_items', 'sync_conflicts')
    `);
    const tables = catalogRows(tableResponse);
    const policies = catalogRows(policyResponse);
    if (tableResponse && !tables) note('FAIL', 'schema  table catalog', `catalog unavailable (HTTP ${tableResponse.response.status})`);
    if (policyResponse && !policies) note('FAIL', 'schema  policy catalog', `catalog unavailable (HTTP ${policyResponse.response.status})`);
    const foundTable = (qualified) => tables?.find((row) => `${row?.schema}.${row?.name}` === qualified);
    if (tables) {
      for (const table of schema.tables) {
        const found = Boolean(foundTable(table));
        note(found ? 'PASS' : 'FAIL', `schema  ${table}`, found ? 'present' : 'missing from the catalog');
      }
      for (const table of schema.forcedRls) {
        const row = foundTable(table);
        const forced = row && (row.rls_enabled === true || row.rls_enabled === 't') && (row.rls_forced === true || row.rls_forced === 't');
        note(forced ? 'PASS' : 'FAIL', `schema  forced RLS ${table}`, forced ? 'enabled and forced' : 'not enabled and forced');
      }
    }
    if (policies) {
      for (const policy of schema.policies) {
        const row = policies.find((item) => item?.policyname === policy.name && `${item.schemaname}.${item.tablename}` === policy.table);
        const ownerOnly = row?.roles === '{sync_owner}';
        note(ownerOnly ? 'PASS' : 'FAIL', `schema  policy ${policy.name}`, ownerOnly ? `on ${policy.table} for sync_owner` : 'missing or not owner-only');
      }
    }
  }
  for (const id of supabaseChecks) {
    if (results.some((row) => row.id === id)) continue;
    const detail = !matchingUrls ? 'matching Supabase project URLs required'
      : !keyPresent && (id.startsWith('R6') || id.startsWith('schema  anon access')) ? `${PUBLISHABLE_KEY_ENV} absent`
      : !managementToken ? 'SUPABASE_ACCESS_TOKEN absent' : 'provider check incomplete';
    note(unreachable ? 'SKIP' : 'FAIL', id, unreachable ? UNREACHABLE : detail);
  }

  // R5 belongs to the Clerk frontend instance. Its published configuration is
  // available without credentials, including when Supabase is paused.
  const clerkEnvironment = await request(
    CLERK_ISSUER + '/v1/environment',
    { headers: { Accept: 'application/json', Origin: APP_ORIGIN }, fetchImpl, timeoutMs },
  ).catch((error) => {
    if (!isUnreachable(error)) throw error;
    return null;
  });
  let clerkSettings = null;
  let clerkCheckDetail = 'Clerk Frontend API unreachable';
  if (clerkEnvironment) {
    const { response, text } = clerkEnvironment;
    clerkCheckDetail = 'Clerk Frontend API HTTP ' + response.status;
    if (response.ok) {
      try {
        clerkSettings = JSON.parse(text)?.user_settings;
        clerkCheckDetail = 'not confirmed';
      } catch {
        clerkCheckDetail = 'Clerk Frontend API returned invalid JSON';
      }
    }
  }
  const bot = clerkSettings?.sign_up?.captcha_enabled === true;
  const email = clerkSettings?.attributes?.email_address?.verify_at_sign_up === true;
  note(bot ? 'PASS' : 'FAIL', 'R5  bot protection', bot ? 'enabled' : clerkCheckDetail);
  note(email ? 'PASS' : 'FAIL', 'R5  email verification', email ? 'required at sign-up' : clerkCheckDetail);

  if (clerkKeyPresent) {
    const headers = { Authorization: `Bearer ${env.CLERK_SECRET_KEY.trim()}`, Accept: 'application/json' };
    const templates = await request('https://api.clerk.com/v1/jwt_templates', { headers, fetchImpl, timeoutMs }).catch((error) => {
      if (!isUnreachable(error)) throw error;
      return null;
    });
    if (!templates) {
      note('SKIP', 'R4  no JWT template', 'Clerk Backend API unreachable');
    } else if (!templates.response.ok) {
      note('FAIL', 'R4  no JWT template', `Clerk JWT templates HTTP ${templates.response.status}`);
    } else {
      const payload = responseJson(templates.text);
      const rows = Array.isArray(payload) ? payload : payload?.data;
      if (!Array.isArray(rows) || !rows.every((row) => typeof row?.name === 'string')) {
        note('FAIL', 'R4  no JWT template', 'invalid JWT template response');
      } else {
        const used = rows.some((row) => /supabase/i.test(row.name));
        note(used ? 'FAIL' : 'PASS', 'R4  no JWT template', used ? 'a JWT template named for the database is present' : 'no database JWT template');
      }
    }
  } else {
    note('FAIL', 'R4  no JWT template', 'CLERK_SECRET_KEY absent');
  }
  note('MANUAL', 'R4  session role', 'confirm the authenticated role on a signed-in test session');
  note('MANUAL', 'R7  user.deleted endpoint', 'confirm the endpoint and test delivery in the Clerk dashboard');

  // Issuer constant is part of the documented R4 domain. Comparing a configured
  // CLERK_JWT_ISSUER without printing it keeps a mismatched issuer visible.
  if (present(env, 'CLERK_JWT_ISSUER')) {
    const matches = env.CLERK_JWT_ISSUER.trim().replace(/\/+$/, '') === CLERK_ISSUER;
    note(matches ? 'PASS' : 'FAIL', 'R4  CLERK_JWT_ISSUER', matches ? 'matches the documented Clerk domain' : 'does not match the documented Clerk domain');
  } else note('FAIL', 'R4  CLERK_JWT_ISSUER', 'absent');

  if (present(env, 'CLERK_WEBHOOK_SIGNING_SECRET')) note('PASS', 'R7  CLERK_WEBHOOK_SIGNING_SECRET', 'present');
  else note('FAIL', 'R7  CLERK_WEBHOOK_SIGNING_SECRET', 'absent');

  const failed = results.some((row) => row.status === 'FAIL');
  const incomplete = results.some((row) => row.status === 'SKIP');
  return { results, unreachable, exitCode: failed ? 1 : incomplete ? 2 : 0, schema };
}

export function formatReport(report) {
  const lines = ['sync:preflight'];
  if (report.unreachable) lines.push(UNREACHABLE);
  for (const row of report.results) lines.push(`${row.status}  ${row.id}  ${row.detail}`);
  const failed = report.results.filter((row) => row.status === 'FAIL').length;
  const skipped = report.results.filter((row) => row.status === 'SKIP').length;
  const summary = report.exitCode === 0 ? 'Automated checks passed. Complete the manual checks before release.'
    : `${failed} failed, ${skipped} incomplete`;
  lines.push(summary);
  return lines.join('\n');
}

async function main(args) {
  const usage = 'Usage: npm run sync:preflight [-- --enabled]';
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const expectEnabled = args.length === 1 && args[0] === '--enabled';
  if (args.length && !expectEnabled) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');
  try {
    const report = await runSyncPreflight({ migrationsDir, expectEnabled });
    console.log(formatReport(report));
    process.exitCode = report.exitCode;
  } catch {
    console.log('FAIL  preflight  stopped before the checklist finished');
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main(process.argv.slice(2));
