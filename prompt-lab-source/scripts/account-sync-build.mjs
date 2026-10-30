// Build-time wiring for account sync. Everything here is a no-op unless the
// build sets VITE_PL_ACCOUNT_SYNC=on with a valid VITE_SUPABASE_URL, so
// production builds without the flag ship byte-identical CSPs and manifests.
//
// What the flag adds, and only the exact origins needed:
//   web /app meta CSP   connect-src += the project's Supabase origin
//   extension manifest  permissions += cookies; host_permissions += Clerk FAPI and Supabase
//   desktop (Tauri)     connect-src += Clerk FAPI and Supabase; shell open += Clerk OAuth authorize
export const CLERK_ORIGIN = 'https://clerk.promptlab.tools';
const SUPABASE_ORIGIN = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;

export function accountSyncBuild(env = process.env) {
  const supabaseOrigin = String(env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const enabled = String(env.VITE_PL_ACCOUNT_SYNC || '').toLowerCase() === 'on' && SUPABASE_ORIGIN.test(supabaseOrigin);
  return { enabled, supabaseOrigin: enabled ? supabaseOrigin : '', clerkOrigin: CLERK_ORIGIN };
}

/** Add origins to one CSP directive, keeping everything else unchanged. */
export function addCspSources(csp, directive, origins) {
  const parts = String(csp).split(';').map((part) => part.trim()).filter(Boolean);
  const index = parts.findIndex((part) => part.split(/\s+/)[0] === directive);
  if (index < 0) return [...parts, `${directive} 'self' ${origins.join(' ')}`].join('; ');
  const tokens = parts[index].split(/\s+/);
  for (const origin of origins) if (!tokens.includes(origin)) tokens.push(origin);
  parts[index] = tokens.join(' ');
  return parts.join('; ');
}

/** Vite plugin for the web app: widen /app's meta CSP connect-src when sync is on. */
export function accountSyncWebCsp(env = process.env) {
  const sync = accountSyncBuild(env);
  return {
    name: 'prompt-lab-account-sync-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!sync.enabled || !/(^|\/)app\/index\.html$/.test(ctx?.filename || ctx?.path || '')) return html;
        return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (all, start, csp, end) => `${start}${addCspSources(csp, 'connect-src', [sync.supabaseOrigin])}${end}`);
      },
    },
  };
}

/** Vite plugin for the extension panel: load the Clerk Sync Host bootstrap only when sync is on. */
export function accountSyncExtensionEntry(env = process.env, entry = '/src/extensionAccountAuth.js') {
  const sync = accountSyncBuild(env);
  return {
    name: 'prompt-lab-account-sync-extension-entry',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!sync.enabled) return html;
        return html.replace('</head>', `  <script type="module" src="${entry}"></script>\n</head>`);
      },
    },
  };
}

/** Extension manifest additions required by Clerk's Chrome SDK with syncHost. */
export function patchExtensionManifest(manifest, env = process.env) {
  const sync = accountSyncBuild(env);
  if (!sync.enabled) return manifest;
  const next = structuredClone(manifest);
  next.permissions = [...new Set([...(next.permissions || []), 'cookies', 'storage'])];
  next.host_permissions = [...new Set([...(next.host_permissions || []), `${sync.clerkOrigin}/*`, `${sync.supabaseOrigin}/*`])];
  return next;
}

/** Tauri --config overlay (JSON merge) for desktop builds with sync on. */
export function desktopSyncOverlay(baseConfig, env = process.env) {
  const sync = accountSyncBuild(env);
  if (!sync.enabled) return null;
  const csp = addCspSources(baseConfig.app.security.csp, 'connect-src', [sync.clerkOrigin, sync.supabaseOrigin]);
  const open = baseConfig.plugins?.shell?.open || '^https://promptlab\\.tools/';
  return {
    app: { security: { csp } },
    plugins: { shell: { open: `(?:${open})|^https://clerk\\.promptlab\\.tools/oauth/authorize\\?` } },
  };
}
