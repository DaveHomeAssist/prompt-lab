// Preview-only Clerk CSP widening (NEW-01, 2026-10-29 re-audit).
//
// The web app's Content-Security-Policy is a <meta> tag in
// prompt-lab-web/app/index.html. It only allows the production Clerk
// frontend API (https://clerk.promptlab.tools). Vercel preview builds use the
// Clerk development instance, whose frontend API lives on
// <slug>.clerk.accounts.dev, so the browser blocks clerk.browser.js and /app
// fails to boot with failed_to_load_clerk_js.
//
// Why this is a build step and not a vercel.json header rule: a CSP sent as a
// response header and a CSP in a <meta> tag are both enforced, and the browser
// intersects them. A host-matched header can only make the policy stricter,
// never allow a host the <meta> policy blocks. So the only way to allow the
// development host on previews is to change the <meta> policy in the preview
// build itself.
//
// Scope, enforced below:
// - runs only when VERCEL_ENV === 'preview' (production and local builds are
//   left byte-for-byte unchanged);
// - adds exactly one origin, derived from the publishable key, and only when
//   that key is a pk_test_ key for a *.clerk.accounts.dev host;
// - touches only script-src and connect-src (clerk-js is loaded as a script
//   and then calls the same frontend API host);
// - only changes pages whose policy already allows the production Clerk host
//   in script-src (today: /app/). The landing and mobile pages stay as built.

export const PRODUCTION_CLERK_ORIGIN = 'https://clerk.promptlab.tools';
const CSP_META_PATTERN = /(<meta http-equiv="Content-Security-Policy" content=")([^"]+)(">)/;
const DEV_FRONTEND_API_HOST = /^[a-z0-9-]+\.clerk\.accounts\.dev$/;
export const PREVIEW_CLERK_DIRECTIVES = Object.freeze(['script-src', 'connect-src']);

// Clerk publishable keys are pk_(test|live)_ + base64("<frontend api host>$").
export function clerkDevFrontendApiHost(publishableKey) {
  const match = /^pk_test_([A-Za-z0-9+/=_-]+)$/.exec(String(publishableKey || '').trim());
  if (!match) return null;
  let decoded;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const host = decoded.replace(/\$$/, '').trim().toLowerCase();
  return DEV_FRONTEND_API_HOST.test(host) ? host : null;
}

export function addOriginToDirectives(csp, origin, directives = PREVIEW_CLERK_DIRECTIVES) {
  return csp
    .split(';')
    .map((part) => {
      const trimmed = part.trim();
      const [name, ...sources] = trimmed.split(/\s+/);
      if (!directives.includes(name) || sources.includes(origin)) return part;
      const leading = part.match(/^\s*/)[0];
      return `${leading}${[name, ...sources, origin].join(' ')}`;
    })
    .join(';');
}

export function applyPreviewClerkCsp(html, env = process.env) {
  if (String(env.VERCEL_ENV || '').trim().toLowerCase() !== 'preview') return html;
  const host = clerkDevFrontendApiHost(env.VITE_CLERK_PUBLISHABLE_KEY);
  if (!host) return html;
  const match = CSP_META_PATTERN.exec(html);
  if (!match) return html;
  const scriptSrc = match[2].split(';').map((part) => part.trim().split(/\s+/)).find(([name]) => name === 'script-src');
  if (!scriptSrc || !scriptSrc.includes(PRODUCTION_CLERK_ORIGIN)) return html;
  return html.replace(CSP_META_PATTERN, (_, open, csp, close) => (
    `${open}${addOriginToDirectives(csp, `https://${host}`)}${close}`
  ));
}

export function previewClerkCsp(env = process.env) {
  return {
    name: 'promptlab-preview-clerk-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return applyPreviewClerkCsp(html, env);
    },
  };
}
