// Talks to the account-sync RPCs through Supabase's REST endpoint with plain
// fetch (no new runtime dependency). The Clerk session token is the bearer;
// Supabase verifies it through Clerk third-party auth and RLS keys rows on its
// `sub`. Only the publishable key ships in the client.
import { SyncHttpError } from './syncEngine.js';

export function createSupabaseTransport({ url, publishableKey, getToken, fetchImpl = (...args) => fetch(...args) }) {
  async function request(path, { method = 'POST', body } = {}) {
    const token = await getToken();
    if (!token) throw new SyncHttpError(401, 'Not signed in.');
    let response;
    try {
      response = await fetchImpl(`${url}/rest/v1/${path}`, {
        method,
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw Object.assign(new Error('Network unavailable.'), { status: 0, cause: error });
    }
    // PostgREST maps the migration's PT413 / PT429 / PT503 errors to those HTTP codes.
    if (!response.ok) throw new SyncHttpError(response.status);
    return response.status === 204 ? null : response.json();
  }
  return {
    pull: (cursor, limit) => request('rpc/sync_pull', { body: { p_cursor: cursor, p_limit: limit } }),
    push: (deviceId, changes) => request('rpc/sync_push', { body: { p_device_id: deviceId, p_changes: changes } }),
    fetchItems: (keys) => request('rpc/sync_fetch', { body: { p_keys: keys } }),
    manifest: () => request('rpc/sync_manifest', { body: {} }),
    status: () => request('rpc/sync_status', { body: {} }),
    listConflicts: () => request('sync_conflicts?select=id,kind,item_id,losing_payload,losing_deleted,created_at&resolved_at=is.null&order=created_at.desc&limit=100', { method: 'GET' }),
    deleteMyData: () => request('rpc/sync_delete_my_data', { body: {} }),
  };
}

/** "Export my data": every synced row, including tombstones, as plain JSON. */
export async function exportAccountData(transport) {
  const items = [];
  let cursor = 0;
  for (;;) {
    const page = await transport.pull(cursor, 1000);
    items.push(...page);
    if (page.length < 1000) break;
    cursor = Math.max(...page.map((row) => Number(row.change_seq)));
  }
  return { format: 'prompt-lab-account-export', version: 1, exportedAt: new Date().toISOString(), items, conflicts: await transport.listConflicts() };
}
