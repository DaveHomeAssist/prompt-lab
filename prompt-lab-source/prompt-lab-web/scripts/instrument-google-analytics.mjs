import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const GOOGLE_ANALYTICS_SCRIPT = '<script src="/google-analytics.js" defer></script>';
const DEFAULT_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const GOOGLE_ANALYTICS_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com; font-src 'self'; connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com; object-src 'none'; base-uri 'self'; form-action 'self'";

function instrumentHtml(html) {
  const withGoogleCsp = html.replace(DEFAULT_CSP, GOOGLE_ANALYTICS_CSP);
  const withGoogleLoader = withGoogleCsp.replace(
    /<script src="\/google-analytics\.js"(?: defer)?><\/script>/,
    GOOGLE_ANALYTICS_SCRIPT,
  );
  if (withGoogleLoader.includes(GOOGLE_ANALYTICS_SCRIPT)) return withGoogleLoader;
  return withGoogleLoader.replace(/<\/head>/i, `  ${GOOGLE_ANALYTICS_SCRIPT}\n</head>`);
}

async function findHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findHtmlFiles(path);
    return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
  }));
  return files.flat();
}

export async function instrumentGoogleAnalytics(directory) {
  const files = await findHtmlFiles(resolve(directory));
  await Promise.all(files.map(async (file) => {
    const html = await readFile(file, 'utf8');
    const instrumented = instrumentHtml(html);
    if (instrumented !== html) await writeFile(file, instrumented, 'utf8');
  }));
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedAsScript) {
  instrumentGoogleAnalytics(process.argv[2] || 'dist').catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
