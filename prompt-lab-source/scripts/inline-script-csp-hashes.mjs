// Replace script-src 'unsafe-inline' with per-build sha256 hashes
// (security pass 2026-11-01, Fire Watch finding 2).
//
// The web pages keep their Content-Security-Policy in a <meta> tag because
// previewClerkCsp() and accountSyncWebCsp() widen it per build (Vercel
// preview Clerk host, Supabase when VITE_PL_ACCOUNT_SYNC=on). A vercel.json
// header CSP is static and is intersected with the meta policy, so it could
// only tighten, never carry those per-build hosts. See
// scripts/preview-clerk-csp.mjs for the full reasoning.
//
// This plugin runs last (order 'post'). For every page whose meta CSP has a
// script-src, it hashes each executable inline <script> exactly as written in
// the final HTML, adds 'sha256-…' sources and removes 'unsafe-inline' from
// script-src. style-src is left alone (React and Clerk set inline styles).
// Inline event-handler attributes (onclick=…) are refused at build time,
// because hashes do not cover them.

import { createHash } from 'node:crypto';

const CSP_META_PATTERN = /(<meta http-equiv="Content-Security-Policy" content=")([^"]+)(">)/;
const INLINE_SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const EXECUTABLE_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);
const INLINE_HANDLER_PATTERN = /<[a-z][^>]*\son[a-z]+\s*=/i;

export function sha256Source(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

export function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of String(html).matchAll(INLINE_SCRIPT_PATTERN)) {
    const attrs = match[1] || '';
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = (/\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] || '').toLowerCase();
    if (!EXECUTABLE_TYPES.has(type)) continue;
    const source = sha256Source(match[2]);
    if (!hashes.includes(source)) hashes.push(source);
  }
  return hashes;
}

export function hashInlineScriptsInCsp(csp, hashes) {
  return String(csp)
    .split(';')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      const [name, ...sources] = trimmed.split(/\s+/);
      if (name !== 'script-src') return part;
      const kept = sources.filter((source) => source !== "'unsafe-inline'" && !source.startsWith("'sha256-"));
      const leading = part.match(/^\s*/)[0];
      return `${leading}${[name, ...kept, ...hashes].join(' ')}`;
    })
    .join(';');
}

export function applyInlineScriptHashes(html) {
  const match = CSP_META_PATTERN.exec(html);
  if (!match || !/(^|;)\s*script-src\s/.test(match[2])) return html;
  const body = html.replace(CSP_META_PATTERN, '');
  if (INLINE_HANDLER_PATTERN.test(body.replace(/<script\b[\s\S]*?<\/script>/gi, ''))) {
    throw new Error('Inline event-handler attribute found; it would be blocked once script-src drops \'unsafe-inline\'. Move it to a script.');
  }
  const hashes = inlineScriptHashes(html);
  return html.replace(CSP_META_PATTERN, (all, start, csp, end) => `${start}${hashInlineScriptsInCsp(csp, hashes)}${end}`);
}

export function inlineScriptCspHashes() {
  return {
    name: 'prompt-lab-inline-script-csp-hashes',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return applyInlineScriptHashes(html);
      },
    },
  };
}
