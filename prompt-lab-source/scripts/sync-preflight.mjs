#!/usr/bin/env node
// Read-only rollout check for account Library sync (docs/ACCOUNT_SYNC_DESIGN.md
// steps R3–R7). Prints a pass/fail checklist. Env values are never printed.
// The only network calls are GETs, plus one SELECT through the Supabase
// management query API when SUPABASE_ACCESS_TOKEN is set. Nothing is written.
//
// A paused or unreachable Supabase project prints "project unreachable or paused"
// and does not fail the process by itself.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UNREACHABLE = 'project unreachable or paused';
export const CLERK_DOMAIN = 'clerk.promptlab.tools';
export const CLERK_ISSUER = `https://${CLERK_DOMAIN}`;
export const WEBHOOK_URL = 'https://promptlab.tools/api/sync/clerk-webhook';
const PROJECT_URL = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/;
const PROBE_MS = 8000;

// Documented R6 names, plus the older anon-key spellings Supabase still accepts.
export const URL_ENV_NAMES = Object.freeze(['VITE_SUPABASE_URL', 'SUPABASE_URL']);
export const ANON_KEY_ENV_NAMES = Object.freeze([
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
]);
export const R6_SERVER_ENV = Object.freeze(['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'CLERK_WEBHOOK_SIGNING_SECRET']);
// Clerk "Connect with Supabase" is a dashboard control. These are the env names
// this repo can check for that connection. Presence only.
export const CLERK_THIRD_PARTY_ENV = Object.freeze(['CLERK_SECRET_KEY']);

const MUTATING = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|execute|merge|vacuum|reindex|cluster|lock|refresh|comment|do)\b/i;

export function present(env, name) {
  return typeof env?.[name] === 'string' && env[name].trim() !== '';
}

export function configuredValue(env, names) {
  for (const name of names) if (present(env, name)) return { name, value: env[name].trim() };
  return { name: names[0], value: '' };
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
  return expectedSyncSchema(files.map((name) => readFileSync(join(directory, name), 'utf8')).join('\n'));
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

function authSettingsView(json) {
  const signupOff = json?.disable_signup === true;
  const anonymousOff = json?.external?.anonymous_users === false;
  return { signupOff, anonymousOff };
}

function clerkProtection(instance) {
  const bot = instance?.attack_protection?.bot_protection?.enabled
    ?? instance?.attack_protection?.bot_protection
    ?? instance?.bot_protection_enabled;
  const email = instance?.attack_protection?.email_verification?.required
    ?? instance?.restrictions?.email_verification
    ?? instance?.user_settings?.attributes?.email_address?.verify_at_sign_up
    ?? instance?.email_settings?.verification_required;
  return { bot: bot === true, email: email === true };
}

function webhookMatches(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.data || payload?.endpoints || [];
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => {
    const url = String(row?.url || row?.endpoint || '');
    const events = row?.events || row?.filter_types || row?.event_types || [];
    const list = Array.isArray(events) ? events.map(String) : [];
    return url === WEBHOOK_URL && (list.includes('user.deleted') || list.includes('*'));
  });
}

function jwtTemplateUsed(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.data || [];
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => /supabase/i.test(String(row?.name || '')));
}

function tableProbeResult(response, text) {
  let code = '';
  try { code = JSON.parse(text)?.code || ''; } catch { /* not json */ }
  if (response.status === 404 || code === 'PGRST205' || /could not find the table/i.test(text)) return 'missing';
  if (response.status === 200) return 'readable';
  if (response.status === 401 || response.status === 403 || code === '42501' || /permission denied/i.test(text)) return 'present';
  return 'unexpected';
}

export async function runSyncPreflight({
  env = process.env,
  fetchImpl = globalThis.fetch,
  migrationsDir,
  timeoutMs = PROBE_MS,
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

  const urlConfig = configuredValue(env, URL_ENV_NAMES);
  const keyConfig = configuredValue(env, ANON_KEY_ENV_NAMES);
  const urlOk = PROJECT_URL.test(urlConfig.value);
  const bothUrls = URL_ENV_NAMES.filter((name) => present(env, name)).map((name) => env[name].trim().replace(/\/+$/, ''));
  const urlsDiffer = bothUrls.length === 2 && bothUrls[0] !== bothUrls[1];

  for (const name of URL_ENV_NAMES) {
    note(present(env, name) ? 'PASS' : 'FAIL', `R6  ${name}`, present(env, name) ? 'present' : 'absent');
  }
  note(
    keyConfig.value ? 'PASS' : 'FAIL',
    'R6  anon key',
    keyConfig.value ? `present as ${keyConfig.name}` : `${ANON_KEY_ENV_NAMES.join(', ')} absent`,
  );
  for (const name of R6_SERVER_ENV) {
    if (name === 'SUPABASE_URL') continue;
    note(present(env, name) ? 'PASS' : 'FAIL', `R6  ${name}`, present(env, name) ? 'present' : 'absent');
  }
  const flagOn = String(env.VITE_PL_ACCOUNT_SYNC || '').toLowerCase() === 'on';
  note(flagOn ? 'PASS' : 'FAIL', 'R6  VITE_PL_ACCOUNT_SYNC=on', flagOn ? 'on' : 'not on');

  for (const name of CLERK_THIRD_PARTY_ENV) {
    note(present(env, name) ? 'PASS' : 'FAIL', `R4  ${name}`, present(env, name) ? 'present' : 'absent');
  }
  if (urlsDiffer) note('FAIL', 'R6  project url', 'VITE_SUPABASE_URL and SUPABASE_URL differ');
  else if (urlConfig.value && !urlOk) note('FAIL', 'R6  project url', `${urlConfig.name} is not a project url`);

  const remote = [];
  const skipRemote = (status, detail) => {
    for (const id of remote) if (!results.some((row) => row.id === id)) note(status, id, detail);
  };
  const expectRemote = (id) => { remote.push(id); };

  [
    'R3  sign-ups off',
    'R3  anonymous sign-ins off',
    'R3  Realtime off',
    'R4  provider domain',
    'R4  no JWT template',
    'R5  bot protection',
    'R5  email verification',
    'R7  user.deleted endpoint',
  ].forEach(expectRemote);
  for (const table of schema.tables) expectRemote(`schema  ${table}`);
  for (const policy of schema.policies) expectRemote(`schema  policy ${policy.name}`);
  for (const table of schema.forcedRls) expectRemote(`schema  forced RLS ${table}`);

  let unreachable = false;
  const markUnreachable = () => {
    unreachable = true;
    for (const id of remote) {
      const existing = results.find((row) => row.id === id);
      if (!existing) note('SKIP', id, UNREACHABLE);
      else if (existing.status !== 'PASS' && existing.status !== 'FAIL') existing.detail = UNREACHABLE;
    }
  };

  const probe = async (url, options) => {
    try {
      const result = await request(url, { ...options, fetchImpl, timeoutMs });
      if (isUnreachable(null, result.response, result.text)) {
        markUnreachable();
        return null;
      }
      return result;
    } catch (error) {
      if (isUnreachable(error)) { markUnreachable(); return null; }
      throw error;
    }
  };

  if (urlOk && keyConfig.value && !urlsDiffer) {
    const origin = urlConfig.value.replace(/\/+$/, '');
    const ref = origin.match(PROJECT_URL)[1];
    const auth = await probe(`${origin}/auth/v1/settings`, { headers: { apikey: keyConfig.value, Accept: 'application/json' } });
    if (auth && !unreachable) {
      let settings = null;
      try { settings = JSON.parse(auth.text); } catch { settings = null; }
      if (!auth.response.ok || !settings) {
        note('FAIL', 'R3  sign-ups off', `auth settings HTTP ${auth.response.status}`);
        note('FAIL', 'R3  anonymous sign-ins off', `auth settings HTTP ${auth.response.status}`);
      } else {
        const view = authSettingsView(settings);
        note(view.signupOff ? 'PASS' : 'FAIL', 'R3  sign-ups off', view.signupOff ? 'disable_signup is true' : 'disable_signup is not true');
        note(view.anonymousOff ? 'PASS' : 'FAIL', 'R3  anonymous sign-ins off', view.anonymousOff ? 'anonymous sign-ins are off' : 'anonymous sign-ins are not off');
      }
      const realtime = await probe(`${origin}/realtime/v1/`, { headers: { apikey: keyConfig.value, Accept: 'application/json' } });
      if (realtime && !unreachable) {
        const off = realtime.response.status === 404;
        note(off ? 'PASS' : 'FAIL', 'R3  Realtime off', off ? 'realtime endpoint is absent' : `realtime endpoint answered HTTP ${realtime.response.status}`);
      }
    }

    if (!unreachable) {
      for (const table of schema.tables.filter((name) => name.startsWith('public.'))) {
        const rel = table.slice('public.'.length);
        const probed = await probe(`${origin}/rest/v1/${rel}?select=user_id&limit=0`, {
          headers: { apikey: keyConfig.value, Accept: 'application/json' },
        });
        if (!probed || unreachable) break;
        const kind = tableProbeResult(probed.response, probed.text);
        if (kind === 'present') note('PASS', `schema  ${table}`, 'present; anon select refused');
        else if (kind === 'missing') note('FAIL', `schema  ${table}`, 'not in the API schema');
        else if (kind === 'readable') note('FAIL', `schema  ${table}`, 'anon key can read the table');
        else note('FAIL', `schema  ${table}`, `unexpected HTTP ${probed.response.status}`);
      }
    }

    if (!unreachable && present(env, 'SUPABASE_ACCESS_TOKEN')) {
      const sqlTables = assertReadOnlySelect(`
        select n.nspname as schema, c.relname as name,
               c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r'
          and ((n.nspname = 'public' and c.relname in ('sync_items', 'sync_conflicts'))
            or (n.nspname = 'sync' and c.relname in ('settings', 'rate', 'egress', 'accounts')))
      `);
      const sqlPolicies = assertReadOnlySelect(`
        select schemaname, tablename, policyname, roles::text as roles
        from pg_policies
        where schemaname = 'public' and tablename in ('sync_items', 'sync_conflicts')
      `);
      const query = async (queryText) => probe('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN.trim()}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query: queryText }),
      });
      const tablesResult = await query(sqlTables);
      const policiesResult = !unreachable && tablesResult ? await query(sqlPolicies) : null;
      if (tablesResult && policiesResult && !unreachable) {
        let tableRows = [];
        let policyRows = [];
        try { tableRows = JSON.parse(tablesResult.text); } catch { tableRows = []; }
        try { policyRows = JSON.parse(policiesResult.text); } catch { policyRows = []; }
        const tables = Array.isArray(tableRows) ? tableRows : tableRows?.result || [];
        const policies = Array.isArray(policyRows) ? policyRows : policyRows?.result || [];
        const foundTable = (qualified) => tables.find((row) => `${row.schema}.${row.name}` === qualified);
        for (const table of schema.tables) {
          const row = foundTable(table);
          if (!results.some((item) => item.id === `schema  ${table}` && item.status === 'PASS')) {
            note(row ? 'PASS' : 'FAIL', `schema  ${table}`, row ? 'present' : 'missing');
          } else if (!row) {
            const existing = results.find((item) => item.id === `schema  ${table}`);
            existing.status = 'FAIL';
            existing.detail = 'missing from the catalog';
          }
        }
        for (const table of schema.forcedRls) {
          const row = foundTable(table);
          const forced = row && (row.rls_enabled === true || row.rls_enabled === 't') && (row.rls_forced === true || row.rls_forced === 't');
          note(forced ? 'PASS' : 'FAIL', `schema  forced RLS ${table}`, forced ? 'enabled and forced' : 'not enabled and forced');
        }
        for (const policy of schema.policies) {
          const row = policies.find((item) => item.policyname === policy.name && `${item.schemaname}.${item.tablename}` === policy.table);
          const ownerOnly = row && String(row.roles || '').includes('sync_owner') && !/anon|authenticated|public/i.test(String(row.roles || ''));
          note(ownerOnly ? 'PASS' : 'FAIL', `schema  policy ${policy.name}`, ownerOnly ? `on ${policy.table} for sync_owner` : 'missing or not owner-only');
        }
      } else if (!unreachable) {
        note('FAIL', 'schema  catalog', `catalog query HTTP ${tablesResult?.response?.status || policiesResult?.response?.status || 0}`);
      }
    } else if (!unreachable) {
      for (const table of schema.tables.filter((name) => name.startsWith('sync.'))) {
        note('FAIL', `schema  ${table}`, 'not readable with the anon key; SUPABASE_ACCESS_TOKEN absent');
      }
      for (const policy of schema.policies) note('FAIL', `schema  policy ${policy.name}`, 'not queried; SUPABASE_ACCESS_TOKEN absent');
      for (const table of schema.forcedRls) note('FAIL', `schema  forced RLS ${table}`, 'not queried; SUPABASE_ACCESS_TOKEN absent');
    }
  } else if (!unreachable) {
    skipRemote('FAIL', urlConfig.value ? 'project url was not queried' : 'project url absent');
  }

  if (present(env, 'CLERK_SECRET_KEY') && !unreachable) {
    const headers = { Authorization: `Bearer ${env.CLERK_SECRET_KEY.trim()}`, Accept: 'application/json' };
    let templates = null;
    let instance = null;
    let hooks = null;
    try {
      templates = await request('https://api.clerk.com/v1/jwt_templates', { headers, fetchImpl, timeoutMs });
      instance = await request('https://api.clerk.com/v1/instance', { headers, fetchImpl, timeoutMs });
      hooks = await request('https://api.clerk.com/v1/webhooks', { headers, fetchImpl, timeoutMs });
    } catch (error) {
      if (!isUnreachable(error)) throw error;
      templates = instance = hooks = null;
    }
    if (!templates) {
      note('FAIL', 'R4  no JWT template', 'Clerk API unreachable');
      note('FAIL', 'R5  bot protection', 'Clerk API unreachable');
      note('FAIL', 'R5  email verification', 'Clerk API unreachable');
      note('FAIL', 'R7  user.deleted endpoint', 'Clerk API unreachable');
    } else {
      let templateJson = null;
      try { templateJson = JSON.parse(templates.text); } catch { templateJson = null; }
      if (!templates.response.ok) note('FAIL', 'R4  no JWT template', `Clerk JWT templates HTTP ${templates.response.status}`);
      else if (jwtTemplateUsed(templateJson)) note('FAIL', 'R4  no JWT template', 'a JWT template named for the database is present');
      else note('PASS', 'R4  no JWT template', 'no database JWT template');

      let instanceJson = null;
      try { instanceJson = instance && instance.response.ok ? JSON.parse(instance.text) : null; } catch { instanceJson = null; }
      const protection = clerkProtection(instanceJson);
      note(protection.bot ? 'PASS' : 'FAIL', 'R5  bot protection', protection.bot ? 'enabled' : 'not confirmed');
      note(protection.email ? 'PASS' : 'FAIL', 'R5  email verification', protection.email ? 'required at sign-up' : 'not confirmed');

      let hookJson = null;
      try { hookJson = hooks && hooks.response.ok ? JSON.parse(hooks.text) : null; } catch { hookJson = null; }
      if (!hooks?.response.ok) note('FAIL', 'R7  user.deleted endpoint', `Clerk webhooks HTTP ${hooks?.response?.status || 0}`);
      else note(webhookMatches(hookJson) ? 'PASS' : 'FAIL', 'R7  user.deleted endpoint', webhookMatches(hookJson) ? 'endpoint subscribed to user.deleted' : 'endpoint not listed');
    }
  } else if (!unreachable) {
    note('FAIL', 'R4  no JWT template', 'CLERK_SECRET_KEY absent');
    note('FAIL', 'R5  bot protection', 'CLERK_SECRET_KEY absent');
    note('FAIL', 'R5  email verification', 'CLERK_SECRET_KEY absent');
      note('FAIL', 'R7  user.deleted endpoint', 'CLERK_SECRET_KEY absent');
  }

  if (!unreachable && !results.some((row) => row.id === 'R4  provider domain')) {
    // The anon key's public auth settings do not list third-party providers.
    // Config-var lines above are the pass/fail check; this step stays visible.
    note('SKIP', 'R4  provider domain', `expected ${CLERK_DOMAIN}; not visible to the anon key`);
  }

  if (!unreachable) {
    for (const id of remote) if (!results.some((row) => row.id === id)) note('FAIL', id, 'not checked');
  }

  // Issuer constant is part of the documented R4 domain. Comparing a configured
  // CLERK_JWT_ISSUER without printing it keeps a mismatched issuer visible.
  if (present(env, 'CLERK_JWT_ISSUER')) {
    const matches = env.CLERK_JWT_ISSUER.trim().replace(/\/+$/, '') === CLERK_ISSUER;
    note(matches ? 'PASS' : 'FAIL', 'R4  CLERK_JWT_ISSUER', matches ? 'matches the documented Clerk domain' : 'does not match the documented Clerk domain');
  } else note('FAIL', 'R4  CLERK_JWT_ISSUER', 'absent');

  if (present(env, 'CLERK_WEBHOOK_SIGNING_SECRET')) note('PASS', 'R7  CLERK_WEBHOOK_SIGNING_SECRET', 'present');
  else note('FAIL', 'R7  CLERK_WEBHOOK_SIGNING_SECRET', 'absent');

  const failed = results.filter((row) => row.status === 'FAIL');
  return { results, unreachable, exitCode: failed.length ? 1 : 0, schema };
}

export function formatReport(report) {
  const lines = ['sync:preflight'];
  if (report.unreachable) lines.push(UNREACHABLE);
  for (const row of report.results) lines.push(`${row.status}  ${row.id}  ${row.detail}`);
  lines.push(report.exitCode === 0 ? 'pass' : `${report.results.filter((row) => row.status === 'FAIL').length} failed`);
  return lines.join('\n');
}

async function main() {
  const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');
  try {
    const report = await runSyncPreflight({ env: process.env, migrationsDir });
    console.log(formatReport(report));
    process.exitCode = report.exitCode;
  } catch (error) {
    if (isUnreachable(error)) {
      console.log(UNREACHABLE);
      process.exitCode = 0;
      return;
    }
    console.log('FAIL  preflight  stopped before the checklist finished');
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
