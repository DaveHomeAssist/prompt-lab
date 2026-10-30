// Shared local-Postgres harness. PGlite is Postgres compiled to WASM: no
// network, no remote project. `claimsFor` mirrors an active Clerk session token.
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const ISSUER = 'https://clerk.promptlab.tools';
export const claimsFor = (sub, extra = {}) => ({ sub, role: 'authenticated', iss: ISSUER, sid: 'sess_test', ...extra });

export function migrationSql() {
  const dir = new URL('../migrations/', import.meta.url);
  return readdirSync(dir).filter((name) => name.endsWith('.sql')).sort().map((file) => readFileSync(new URL(file, dir), 'utf8'));
}
export const shimSql = () => readFileSync(new URL('supabase-shim.sql', import.meta.url), 'utf8');

export async function createDb() {
  const db = new PGlite();
  await db.exec(shimSql());
  for (const sql of migrationSql()) await db.exec(sql);
  return db;
}

// Run fn as a role with the given JWT claims (null = anon, string = Clerk user id).
export function asRole(db) {
  let chain = Promise.resolve();
  return (claims, fn, role = 'authenticated') => {
    const run = async () => {
      await db.exec('reset role');
      if (claims === null) {
        await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', false)`);
        await db.exec('set role anon');
      } else {
        const value = typeof claims === 'string' ? claimsFor(claims) : claims;
        await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(value)]);
        await db.exec(`set role ${role}`);
      }
      try { return await fn(); } finally { await db.exec('reset role'); }
    };
    const next = chain.then(run, run);
    chain = next.catch(() => {});
    return next;
  };
}

// Call a client RPC the way PostgREST does (R-08): one transaction that
// commits even when the RPC answers with a refusal. A refusal is the
// response.status / X-Sync-Error / X-Sync-Code the function set; it is thrown
// as an error carrying `code` (for example PT429) and `status`, like a raised one.
export function rpcRunner(db, as = asRole(db)) {
  return (claims, sql, params) => as(claims, async () => {
    await db.exec('begin');
    let open = true;
    try {
      const result = await db.query(sql, params);
      const [guc] = (await db.query(`select current_setting('response.status', true) as status, current_setting('response.headers', true) as headers`)).rows;
      await db.exec('commit'); open = false;
      const status = Number(guc.status || 0);
      if (status >= 400) {
        const headers = Object.assign({}, ...JSON.parse(guc.headers || '[]'));
        throw Object.assign(new Error(headers['X-Sync-Error'] || `status ${status}`), { code: headers['X-Sync-Code'], status, refusal: true });
      }
      return result.rows;
    } finally {
      if (open) await db.exec('rollback').catch(() => {});
    }
  });
}
