// Live-render responsive QA for the Prompt Lab landing page.
//
// Captures screenshots and structured findings across 11 viewports.
//
// Run:
//   BASE=http://127.0.0.1:8779 node .playwright-cli/verify-responsive-breakpoints.mjs

import fs from 'node:fs';
import path from 'node:path';

const PW_PATH = process.env.PLAYWRIGHT_PATH ||
  'C:/Users/Dave RambleOn/AppData/Local/Temp/garden-os-pw/node_modules/playwright/index.mjs';
const pwUrl = 'file:///' + PW_PATH.replace(/\\/g, '/').replace(/^\/+/, '');
const { chromium } = await import(pwUrl);

const BASE = process.env.BASE || 'http://127.0.0.1:8779';
const TARGET = process.env.TARGET || '/index.html';
const OUT_DIR = path.resolve('.playwright-cli/responsive-landing');
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: '4k-desktop',          width: 3840, height: 2160, mobile: false },
  { name: '1080p-desktop',       width: 1920, height: 1080, mobile: false },
  { name: '16-9-mid-desktop',    width: 1600, height:  900, mobile: false },
  { name: '720p-desktop',        width: 1280, height:  720, mobile: false },
  { name: 'ipad-portrait',       width:  768, height: 1024, mobile: true  },
  { name: 'ipad-landscape',      width: 1024, height:  768, mobile: true  },
  { name: 'iphone-portrait',     width:  390, height:  844, mobile: true  },
  { name: 'iphone-landscape',    width:  844, height:  390, mobile: true  },
  { name: 'galaxy-s-portrait',   width:  360, height:  800, mobile: true  },
  { name: 'galaxy-s-landscape',  width:  800, height:  360, mobile: true  },
  { name: 'galaxy-fold',         width:  280, height:  653, mobile: true  },
];

const results = [];
const browser = await chromium.launch();

try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      deviceScaleFactor: vp.mobile ? 2 : 1,
      userAgent: vp.mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    const resp = await page.goto(BASE + TARGET, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => ({ ok: () => false, status: () => 0, _err: e.message }));
    await page.waitForTimeout(700);

    // Probe layout properties.
    const probe = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const overflowX = doc.scrollWidth > window.innerWidth + 1;
      const overflowAmount = doc.scrollWidth - window.innerWidth;

      function visible(sel) {
        const el = document.querySelector(sel);
        if (!el) return { found: false };
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          found: true,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
          right: rect.right,
          fontSize: parseFloat(cs.fontSize),
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          overflows: rect.right > window.innerWidth + 1,
          clipped: rect.left < -1 || rect.top < -1,
        };
      }

      // Probe key surfaces of the landing.
      const probes = {
        nav:               visible('nav, header'),
        hero:              visible('.hero, [class*="hero"], h1'),
        h1:                visible('h1'),
        ctaPrimary:        visible('.btn-primary, .cta, [class*="cta-"], a[class*="primary"]'),
        pricingCard:       visible('.pricing-card'),
        pricingCardPro:    visible('.pricing-card.featured'),
        finalCta:          visible('.cta-section, [class*="cta-section"]'),
        features:          visible('.features, [class*="feature-"]'),
      };

      // Tap-target check on interactive elements (buttons + links in viewport).
      const tinyTargets = [];
      const interactive = document.querySelectorAll('a, button, input[type="submit"], input[type="button"]');
      let visibleInteractive = 0;
      interactive.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        visibleInteractive++;
        // 44x44 is iOS tap-target guidance; report below 32x32 as tiny.
        if (rect.width < 32 || rect.height < 32) {
          const label = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('href') || '').trim().slice(0, 50);
          tinyTargets.push({ tag: el.tagName, label, w: Math.round(rect.width), h: Math.round(rect.height) });
        }
      });

      // Tiny font detection on top-of-page text.
      const tinyText = [];
      document.querySelectorAll('p, li, span, a, button').forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs > 0 && fs < 11 && (el.textContent || '').trim().length > 4) {
          tinyText.push({ tag: el.tagName, fs: fs.toFixed(1), text: (el.textContent || '').trim().slice(0, 40) });
        }
      });

      // Confirm whether the touch media query is matching in this context.
      const touchMQ = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
      const finePointerMQ = window.matchMedia('(pointer: fine)').matches;

      // Sample the actual rendered tap-target sizes for the four nav links so
      // before/after deltas show up in the report.
      const navLinkSamples = Array.from(document.querySelectorAll('.nav .nav-link'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { text: (el.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height) };
        });

      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: doc.scrollWidth,
        scrollHeight: doc.scrollHeight,
        bodyClassList: Array.from(body.classList),
        touchMQ,
        finePointerMQ,
        navLinkSamples,
        overflowX,
        overflowAmount,
        probes,
        visibleInteractive,
        tinyTargets: tinyTargets.slice(0, 8),
        tinyText: tinyText.slice(0, 8),
      };
    });

    const screenshot = path.join(OUT_DIR, vp.name + '.png');
    await page.screenshot({ path: screenshot, fullPage: false });

    // Also full-page in a separate file for layout audit.
    const screenshotFull = path.join(OUT_DIR, vp.name + '-fullpage.png');
    await page.screenshot({ path: screenshotFull, fullPage: true });

    results.push({
      name: vp.name,
      width: vp.width,
      height: vp.height,
      mobile: vp.mobile,
      httpStatus: resp && resp.status ? resp.status() : 0,
      consoleErrors,
      pageErrors,
      probe,
      screenshot,
      screenshotFull,
    });

    await ctx.close();
  }
} finally {
  await browser.close();
}

// Score each viewport.
function scoreViewport(r) {
  const issues = [];
  let severity = 'pass';
  if (!r.httpStatus || r.httpStatus >= 400) {
    issues.push(`HTTP ${r.httpStatus}`);
    severity = 'fail';
  }
  if (r.pageErrors.length) {
    issues.push(`pageerror: ${r.pageErrors.slice(0, 2).join(' | ')}`);
    severity = 'fail';
  }
  if (r.consoleErrors.length) {
    issues.push(`${r.consoleErrors.length} console.error`);
    if (severity === 'pass') severity = 'warn';
  }
  if (r.probe.overflowX) {
    issues.push(`horizontal overflow ${r.probe.overflowAmount}px (scrollW ${r.probe.scrollWidth} > innerW ${r.probe.innerWidth})`);
    severity = 'fail';
  }
  if (!r.probe.probes.h1.found) {
    issues.push('no h1 found');
    severity = 'fail';
  } else if (r.probe.probes.h1.fontSize < 18 && r.width > 700) {
    issues.push(`h1 only ${r.probe.probes.h1.fontSize}px on a ${r.width}px viewport`);
    if (severity !== 'fail') severity = 'warn';
  }
  if (!r.probe.probes.ctaPrimary.found) {
    issues.push('no primary CTA detected');
    if (severity !== 'fail') severity = 'warn';
  } else if (r.probe.probes.ctaPrimary.overflows) {
    issues.push('primary CTA overflows viewport right edge');
    severity = 'fail';
  }
  if (r.probe.probes.pricingCard.found && r.probe.probes.pricingCard.overflows) {
    issues.push('pricing card overflows viewport right edge');
    severity = 'fail';
  }
  if (r.probe.tinyTargets.length > 0) {
    issues.push(`${r.probe.tinyTargets.length} tap targets < 32x32 (e.g. ${r.probe.tinyTargets.slice(0, 2).map((t) => `${t.tag}@${t.w}x${t.h}`).join(', ')})`);
    if (severity === 'pass') severity = 'warn';
  }
  if (r.probe.tinyText.length > 0 && r.mobile) {
    issues.push(`${r.probe.tinyText.length} text nodes < 11px (mobile)`);
    if (severity === 'pass') severity = 'warn';
  }
  return { severity, issues };
}

const summary = results.map((r) => ({ ...r, ...scoreViewport(r) }));

// Print human report.
console.log('\n=== Responsive Render QA Summary ===\n');
const colWidths = [22, 12, 8];
console.log(
  'Viewport'.padEnd(colWidths[0]) + 'Size'.padEnd(colWidths[1]) + 'Status'.padEnd(colWidths[2]) + 'Issues'
);
console.log('-'.repeat(80));
for (const r of summary) {
  const status = r.severity === 'pass' ? 'PASS' : r.severity === 'warn' ? 'WARN' : 'FAIL';
  console.log(
    r.name.padEnd(colWidths[0]) +
    `${r.width}x${r.height}`.padEnd(colWidths[1]) +
    status.padEnd(colWidths[2]) +
    (r.issues.length ? r.issues.join('; ') : 'clean')
  );
}

// Write structured JSON for further analysis.
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'summary.txt'), summary.map((r) => {
  const status = r.severity === 'pass' ? 'PASS' : r.severity === 'warn' ? 'WARN' : 'FAIL';
  return `[${status}] ${r.name} ${r.width}x${r.height} - ${r.issues.length ? r.issues.join('; ') : 'clean'}`;
}).join('\n'));

const fails = summary.filter((r) => r.severity === 'fail').length;
const warns = summary.filter((r) => r.severity === 'warn').length;
console.log(`\nFAIL ${fails} / WARN ${warns} / PASS ${summary.length - fails - warns} of ${summary.length}`);
console.log(`Screenshots and JSON in ${OUT_DIR}`);
process.exit(0);
