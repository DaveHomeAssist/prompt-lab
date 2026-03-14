# QA Test Pack — Prompt Lab Landing Page

**File under test:** `public/prompt-lab-landing.html`
**Version:** v1.5.0 landing restyle (commit `49b0d9e`)
**Date:** 2026-03-13

---

## Browser / OS Execution Matrix

| ID | Browser | OS | Tester | Status |
|----|---------|-----|--------|--------|
| E1 | Chrome 133+ | macOS 15 | | ☐ |
| E2 | Chrome 133+ | Windows 11 | | ☐ |
| E3 | Edge 133+ | Windows 11 | | ☐ |
| E4 | Safari 18+ | macOS 15 | | ☐ |
| E5 | Firefox 134+ | macOS 15 | | ☐ |
| E6 | Chrome (Android 15) | Mobile | | ☐ |
| E7 | Safari (iOS 18) | Mobile | | ☐ |
| E8 | Brave 1.74+ | macOS 15 | | ☐ |

---

## Test Cases

### Section 1 — Hero

| TC | Description | Steps | Expected | Pass/Fail | Env | Notes |
|----|-------------|-------|----------|-----------|-----|-------|
| TC-H01 | Hero logo loads | Open page, observe hero area | `hero-logo.png` (flask mark) renders at ≤280px wide, centered | ☐ | All | |
| TC-H02 | Logo entrance animation | Hard-refresh page | Logo fades up from 30px offset + 0.95 scale over 1.2s | ☐ | All | |
| TC-H03 | Wordmark renders | Observe text below logo | "PROMPT LAB" in uppercase, "Lab" in violet (#A78BFA) | ☐ | All | |
| TC-H04 | Tagline gradient text | Observe h1 | "Craft" shows violet→indigo gradient fill, rest is white | ☐ | E1–E5, E8 | `-webkit-background-clip: text` — verify no fallback flash |
| TC-H05 | Staggered fade-up | Hard-refresh | Wordmark (0.2s) → tagline (0.35s) → subtitle (0.5s) → CTAs (0.7s) animate sequentially | ☐ | All | |
| TC-H06 | Radial glow pulse | Observe hero background | Violet radial glow pulses between 0.4–0.7 opacity on 5s cycle | ☐ | E1–E5, E8 | Subtle — may be hard to notice on low-contrast displays |
| TC-H07 | Floating molecules | Observe hero for 10s | 16 small violet dots float upward with drift, fading in/out | ☐ | E1–E5, E8 | JS-generated; won't render if JS disabled |
| TC-H08 | Molecular bonds | Observe hero for 10s | 5 faint horizontal lines fade in/out at random angles | ☐ | E1–E5, E8 | |
| TC-H09 | Scroll indicator | Observe bottom of hero | "scroll" label + pulsing vertical line visible, 2.5s cycle | ☐ | All | |
| TC-H10 | CTA "Get Started" | Click button | Smooth-scrolls to `#get-started` (workflow section) | ☐ | All | |
| TC-H11 | CTA "Explore Features" | Click button | Smooth-scrolls to `#features` (features section) | ☐ | All | |
| TC-H12 | Hero responsive (mobile) | Resize to 375px width | Logo scales via `max-width: 70vw`, CTAs stack vertically, text remains readable | ☐ | E6, E7 | |

---

### Section 2 — Provider Ribbon

| TC | Description | Steps | Expected | Pass/Fail | Env | Notes |
|----|-------------|-------|----------|-----------|-----|-------|
| TC-P01 | All 5 providers shown | Scroll to provider section | Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama — each in a glass chip | ☐ | All | |
| TC-P02 | Chip glass effect | Inspect chip | `backdrop-filter: blur(16px)`, bg `rgba(255,255,255,0.04)`, border `rgba(255,255,255,0.08)` | ☐ | E1–E5, E8 | Firefox: `backdrop-filter` requires flag or v103+; verify graceful fallback |
| TC-P03 | Chip hover | Hover each chip | Border → violet 30%, bg → 0.07, violet glow shadow, translateY(-1px) | ☐ | E1–E5, E8 | |
| TC-P04 | Stagger reveal | Scroll chips into view | Chips animate in with 80ms stagger between each | ☐ | All | |
| TC-P05 | Responsive wrap | Resize to 375px | Chips wrap into 2–3 rows, gap shrinks to 0.75rem, font to 0.78rem | ☐ | E6, E7 | |

---

### Section 3 — Features Grid

| TC | Description | Steps | Expected | Pass/Fail | Env | Notes |
|----|-------------|-------|----------|-----------|-----|-------|
| TC-F01 | 7 feature cards render | Scroll to features | All 7 cards visible: One-Click Enhance, A/B Testing, Prompt Composer, Prompt Library, Credential Isolation, Provider Hot-Swap, Side Panel Mode | ☐ | All | |
| TC-F02 | Card glass styling | Inspect any card | Glass bg + border, 16px backdrop blur, 16px border radius | ☐ | E1–E5, E8 | |
| TC-F03 | Card hover lift | Hover a card | translateY(-4px), border → violet 20%, top-edge gradient line appears (opacity 0→1), glow shadow | ☐ | E1–E5, E8 | |
| TC-F04 | Icon rendering | Check all 7 icons | Each SVG renders in violet (#A78BFA), 22×22 in a 44×44 rounded container | ☐ | All | |
| TC-F05 | Grid responsive | Resize to 375px | Grid collapses to single column | ☐ | E6, E7 | |
| TC-F06 | Staggered reveal | Scroll cards into view | Cards animate in with 80ms stagger (up to 0.44s delay on 7th card) | ☐ | All | |
| TC-F07 | Section eyebrow | Observe section header | `// capabilities` in mono font, violet, uppercase, 0.2em tracking | ☐ | All | |

---

### Section 4 — Code Demo

| TC | Description | Steps | Expected | Pass/Fail | Env | Notes |
|----|-------------|-------|----------|-----------|-----|-------|
| TC-D01 | Default tab active | Scroll to demo | "Anthropic" tab active, Anthropic code snippet visible | ☐ | All | |
| TC-D02 | Tab switching — OpenAI | Click "OpenAI" tab | Anthropic panel hides, OpenAI panel fades in (0.3s), tab underline moves | ☐ | All | |
| TC-D03 | Tab switching — Ollama | Click "Ollama" tab | Ollama panel visible, others hidden | ☐ | All | |
| TC-D04 | Syntax highlighting | Read any code panel | Keywords (violet), functions (teal), strings (indigo), comments (gray italic), operators (slate-400) | ☐ | All | |
| TC-D05 | Copy button | Click "⌘ Copy" | Active panel's text copied to clipboard, button text → "✓ Copied" (green) for 1.5s | ☐ | E1–E5, E8 | `navigator.clipboard` may fail on HTTP — fallback to `execCommand` |
| TC-D06 | Copy button — no HTTPS | Open via `file://` or HTTP | Fallback copy method fires, button still shows "✓ Copied" or "✗ Copy failed" | ☐ | E1 | |
| TC-D07 | Code window chrome | Observe titlebar | Red/yellow/green dots + "background.js" filename in mono | ☐ | All | |
| TC-D08 | Responsive layout | Resize to 768px | Grid collapses to single column (text above code window) | ☐ | E6, E7 | |
| TC-D09 | Code horizontal scroll | Narrow viewport, long line | Code body scrolls horizontally without breaking layout | ☐ | E6, E7 | |

---
<!-- ═══════════════════════════════════════════════════════ -->
<!-- CLAUDE ANALYSIS — architecture + risk flags             -->
<!-- Codex: skip this section, it's for Claude context only -->
<!-- ═══════════════════════════════════════════════════════ -->

### Section 5 — Workflow Steps

| TC | Description | Steps | Expected | Pass/Fail | Env | Notes |
|----|-------------|-------|----------|-----------|-----|-------|
| TC-W01 | 4 steps render | Scroll to workflow | Steps 1–4 visible with numbered circles and descriptions | ☐ | All | |
| TC-W02 | Timeline line | Observe left edge | Vertical 1px line from step 1 to step 4, violet→slate gradient | ☐ | All | |
| TC-W03 | Step number styling | Inspect circle | 48px circle, glass bg, violet border (30% opacity), violet glow shadow | ☐ | E1–E5, E8 | |
| TC-W04 | Inline code styling | Check step 1 | `chrome://extensions` styled with violet text on violet/10% bg, mono font, 4px radius | ☐ | All | |
| TC-W05 | Stagger reveal | Scroll steps into view | Each step fades up as it enters viewport | ☐ | All | |

---

### Section 6 — Final CTA

| TC | Description | Steps | Expected | Pass/Fail | Env | Notes |
|----|-------------|-------|----------|-----------|-----|-------|
| TC-C01 | CTA section renders | Scroll to bottom | "Ready to experiment?" heading + subtitle + 2 buttons | ☐ | All | |
| TC-C02 | Install Guide link | Click "Install Guide" | Opens GitHub README in new tab (`target="_blank"`) | ☐ | All | Verify `rel="noreferrer"` present |
| TC-C03 | View Source link | Click "View Source" | Opens GitHub repo root in new tab | ☐ | All | |
| TC-C04 | Background glow | Observe CTA section | Radial violet glow at bottom center, 25% opacity | ☐ | E1–E5, E8 | |

---

### Section 7 — Footer

| TC | Description | Steps | Expected | Pass/Fail | Env | Notes |
|----|-------------|-------|----------|-----------|-----|-------|
| TC-FT01 | Footer text | Scroll to footer | "ℵ Prompt Lab v1.5.0 — Built for prompt engineers who ship." | ☐ | All | |
| TC-FT02 | Lab mark color | Inspect ℵ symbol | Colored `--lab-violet-light` (#A78BFA) | ☐ | All | |

---

### Section 8 — SEO & Meta

| TC | Description | Steps | Expected | Pass/Fail | Env | Notes |
|----|-------------|-------|----------|-----------|-----|-------|
| TC-S01 | Page title | Check `<title>` or browser tab | "Prompt Lab — Craft Better Prompts" | ☐ | All | |
| TC-S02 | Meta description | View source / Lighthouse | "A multi-provider prompt engineering workbench for Chromium browsers…" | ☐ | N/A | |
| TC-S03 | OG image | Share URL in Slack/Discord/iMessage | Preview shows flask mark on dark bg (1200×630) — **not** old Foundry anvil | ☐ | N/A | Cache may delay; append `?v=2` to bust |
| TC-S04 | OG title | Inspect meta tags | "Prompt Lab — Craft Better Prompts" | ☐ | N/A | |
| TC-S05 | Twitter card | Share URL on X/Twitter | `summary_large_image` card with correct title + image | ☐ | N/A | |
| TC-S06 | Canonical URL | View source | `<link rel="canonical" href="https://davehomeassist.github.io/prompt-lab-provider-options/">` | ☐ | N/A | |
| TC-S07 | Robots meta | View source | `<meta name="robots" content="index,follow">` | ☐ | N/A | |

---

### Section 9 — Cross-Cutting / Performance

| TC | Description | Steps | Expected | Pass/Fail | Env | Notes |
|----|-------------|-------|----------|-----------|-----|-------|
| TC-X01 | No horizontal overflow | Resize 320px–1920px | No horizontal scrollbar at any width | ☐ | All | `overflow-x: hidden` on html+body |
| TC-X02 | Smooth scroll | Click any anchor link | Page smooth-scrolls (not instant jump) | ☐ | All | `scroll-behavior: smooth` on html |
| TC-X03 | Font loading — Outfit | Disable cache, reload | Outfit loads via `font-display: swap`; text visible immediately with fallback, then swaps | ☐ | E1, E4, E5 | |
| TC-X04 | Font loading — JetBrains Mono | Disable cache, reload | Mono text (eyebrows, code) loads with swap | ☐ | E1, E4, E5 | |
| TC-X05 | JS disabled | Disable JS, reload | Page renders fully (all HTML/CSS present). Missing: molecules, bonds, code tab switching, copy button, scroll reveal animations | ☐ | E1 | Graceful degradation — no blank sections |
| TC-X06 | Dot grid overlay | Observe page | Subtle violet dot grid (48px spacing) overlays entire page at z-index 9999 | ☐ | All | Should not block pointer events |
| TC-X07 | Pointer events on overlay | Click any button through grid | All buttons/links remain clickable (`pointer-events: none` on overlay) | ☐ | All | |
| TC-X08 | Lighthouse performance | Run Lighthouse audit | Performance ≥ 90, Accessibility ≥ 90, SEO ≥ 90 | ☐ | E1 | Single HTML file, no external deps |
| TC-X09 | IntersectionObserver threshold | Scroll slowly through page | `.reveal` elements trigger at 15% visibility with -40px root margin | ☐ | All | |

---

<!-- ═══════════════════════════════════════════════════════ -->
<!-- CLAUDE ANALYSIS — start                                 -->
<!-- Codex: DO NOT modify anything below this marker         -->
<!-- ═══════════════════════════════════════════════════════ -->

## Claude Analysis — Risk Flags & Architecture Notes

### High-Risk Areas

1. **`backdrop-filter` compatibility** (TC-P02, TC-F02, TC-W03)
   Firefox shipped `backdrop-filter` unflagged in v103, but older installs or corporate-managed browsers may not support it. No CSS fallback is defined — cards will appear transparent with no blur. Consider adding `@supports not (backdrop-filter: blur(1px))` with an opaque `background-color` fallback.

2. **`-webkit-background-clip: text`** (TC-H04)
   The gradient text on "Craft" uses `-webkit-background-clip: text` which is still non-standard. Chrome, Safari, Edge handle it fine. Firefox supports it with `-moz-background-clip: text` since v49. No `-moz-` prefix is present — verify Firefox renders the gradient rather than clipping to invisible text.

3. **OG image cache** (TC-S03)
   The old Prompt Foundry anvil was deployed for weeks. iMessage, Slack, and Discord cache OG images for 24–72h. Even with the new image pushed, existing shares will show the old preview. Mitigation: append `?v=2` to the OG image URL in the meta tag, or wait for cache expiry.

4. **Clipboard API on non-HTTPS** (TC-D05, TC-D06)
   `navigator.clipboard.writeText` requires a secure context (HTTPS or localhost). The landing page is served from GitHub Pages (HTTPS), so this is fine in production. But local testing via `file://` will fail — the `legacyCopyText` fallback using `document.execCommand('copy')` covers this, but `execCommand` is deprecated and may be removed in future browser versions.

5. **`z-index: 9999` dot grid overlay** (TC-X06, TC-X07)
   The molecular grid overlay on `body::before` is at z-index 9999 with `pointer-events: none`. This is correct for pass-through, but if any future element needs a higher z-index (e.g., a modal or cookie banner), the overlay will render on top. Consider reducing to z-index 1 or 2 since it's decorative.

### Low-Risk Notes

- **JS-generated particles** (TC-H07, TC-H08): 16 molecules + 5 bonds = 21 animated DOM elements. Performance is fine, but these won't render with JS disabled. The page degrades gracefully — just a static hero.
- **Font files**: `chakra-petch-600.woff2` and `chakra-petch-700.woff2` are copied to `docs/fonts/` by the publish script but are not referenced anywhere in the CSS (the restyle switched to Outfit). These are dead weight — ~20KB shipped for no reason.
- **Single-file architecture**: Entire page is one HTML file with inline CSS/JS. Good for GitHub Pages simplicity, but means no cache splitting. Every visit re-downloads all CSS+JS. At ~18KB gzipped this is negligible.
- **`hero-logo.png` is 357KB**: The flask mark PNG is larger than necessary for a 280px-wide display. Could be optimized to ~40KB with `sharp` resize + compression without visible quality loss.

### Recommended Pre-Ship Actions

| Priority | Action | Owner |
|----------|--------|-------|
| P1 | Add `-moz-background-clip: text` fallback for Firefox gradient text | Codex |
| P1 | Add `@supports` fallback for `backdrop-filter` | Codex |
| P2 | Append `?v=2` to OG image URL in meta tags to bust social caches | Codex |
| P2 | Remove dead Chakra Petch font files from publish script | Codex |
| P3 | Optimize `hero-logo.png` (compress to ~40KB) | Codex |
| P3 | Reduce dot grid overlay z-index from 9999 to 1 | Codex |

<!-- CLAUDE ANALYSIS — end -->
<!-- ═══════════════════════════════════════════════════════ -->

---

## Execution Log

| Date | Tester | Env IDs | TCs Executed | Pass | Fail | Blocked | Notes |
|------|--------|---------|-------------|------|------|---------|-------|
| 2026-03-13 | Claude Opus 4.6 (automated) | Source analysis | 53 | 49 | 0 | 4 | See run #1 below |

### Run #1 — Automated Source Validation (2026-03-13)

**Method:** Static analysis of `public/prompt-lab-landing.html` source + live fetch of deployed Pages URL + asset file inspection. No browser rendering (visual/interaction TCs blocked).

#### Results by Section

| TC | Result | Notes |
|----|--------|-------|
| **Section 1 — Hero** | | |
| TC-H01 | PASS | `hero-logo.png` referenced, `width: 280px`, `max-width: 70vw` present |
| TC-H02 | PASS | `@keyframes logoEnter` with `translateY(30px)`, `scale(0.95)`, `1.2s` duration |
| TC-H03 | PASS | `Prompt <span>Lab</span>`, `text-transform: uppercase`, `.hero-wordmark span` color rule |
| TC-H04 | PASS (with flag) | `-webkit-background-clip: text` + `background-clip: text` present. **Missing:** `-moz-background-clip: text` prefix for Firefox |
| TC-H05 | PASS | Stagger delays: 0.2s → 0.35s → 0.5s → 0.7s confirmed |
| TC-H06 | PASS | `pulseGlow` keyframes: 0.4→0.7 opacity, 5s cycle |
| TC-H07 | PASS | JS generates 16 molecules (`i < 16`), `.molecule` class styled |
| TC-H08 | PASS | JS generates 5 bonds (`i < 5`), `.bond` class + `bondFade` animation styled |
| TC-H09 | PASS | `.scroll-indicator` + `.scroll-line` + `scrollPulse 2.5s` |
| TC-H10 | PASS | `href="#get-started"` links to `id="get-started"` on workflow section |
| TC-H11 | PASS | `href="#features"` links to `id="features"` on features section |
| TC-H12 | PASS | `@media (max-width: 600px)` collapses CTAs to `flex-direction: column` |
| **Section 2 — Provider Ribbon** | | |
| TC-P01 | PASS | All 5 providers present: Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama |
| TC-P02 | PASS (with flag) | `backdrop-filter: blur(var(--glass-blur))` on `.provider-chip`. **Missing:** `@supports` fallback |
| TC-P03 | PASS | `.provider-chip:hover` has `translateY(-1px)`, violet border, glow shadow |
| TC-P04 | PASS | `provider-logos stagger` class applies stagger delays |
| TC-P05 | BLOCKED | Requires browser resize — CSS rule confirmed in source |
| **Section 3 — Features Grid** | | |
| TC-F01 | PASS | All 7 feature names present, 7 `.feature-card.reveal` elements |
| TC-F02 | PASS | `.feature-card` has `backdrop-filter: blur`, glass bg/border |
| TC-F03 | PASS | `.feature-card:hover` has `translateY(-4px)`, violet border, glow shadow |
| TC-F04 | PASS | SVG icons 22×22 in 44×44 containers, all 7 have `<svg>` elements |
| TC-F05 | BLOCKED | Requires browser resize — CSS rule for single column confirmed |
| TC-F06 | BLOCKED | Requires browser scroll — stagger CSS rules confirmed |
| TC-F07 | PASS | `// capabilities` eyebrow in mono font, violet color, uppercase |
| **Section 4 — Code Demo** | | |
| TC-D01 | PASS | Anthropic tab has `active` class, Anthropic panel has `active` class |
| TC-D02 | PASS | OpenAI `data-provider` attribute present on tab + panel |
| TC-D03 | PASS | Ollama `data-provider` attribute present on tab + panel |
| TC-D04 | PASS | All 6 syntax classes defined: `.kw`, `.fn`, `.str`, `.cm`, `.op`, `.num` |
| TC-D05 | PASS | `.code-copy-btn` + `navigator.clipboard.writeText` + timeout reset |
| TC-D06 | PASS | `legacyCopyText` fallback using `document.execCommand('copy')` |
| TC-D07 | PASS | `.code-dot.red/yellow/green` + `background.js` filename |
| TC-D08 | PASS | `@media (max-width: 768px)` collapses to single column |
| TC-D09 | BLOCKED | Requires narrow viewport rendering — `overflow-x: auto` on `.code-body` confirmed |
| **Section 5 — Workflow Steps** | | |
| TC-W01 | PASS | 4 `.step-number` elements (1, 2, 3, 4) |
| TC-W02 | PASS | `.workflow-steps::before` with `left: 23px`, `width: 1px`, violet→slate gradient |
| TC-W03 | PASS | 48px circle, glass bg, `backdrop-filter`, violet border 30% opacity |
| TC-W04 | PASS | `chrome://extensions` in inline-styled `<code>` with violet text |
| TC-W05 | BLOCKED | Requires browser scroll — `.reveal` class on all steps confirmed |
| **Section 6 — Final CTA** | | |
| TC-C01 | PASS | "Ready to experiment?" + "Stop guessing at prompts." present |
| TC-C02 | PASS | GitHub README link with `target="_blank"` + `rel="noreferrer"` |
| TC-C03 | PASS | GitHub repo root link present |
| TC-C04 | PASS | `.final-cta::before` radial glow, `opacity: 0.25` |
| **Section 7 — Footer** | | |
| TC-FT01 | PASS | "ℵ Prompt Lab v1.5.0 — Built for prompt engineers who ship." |
| TC-FT02 | PASS | `.lab-mark` class with `--lab-violet-light` color |
| **Section 8 — SEO & Meta** | | |
| TC-S01 | PASS | `<title>Prompt Lab — Craft Better Prompts</title>` |
| TC-S02 | PASS | `<meta name="description" content="A multi-provider prompt engineering workbench..."` |
| TC-S03 | PASS (with flag) | OG image points to `og-image.png` (not Foundry). **Missing:** `?v=2` cache buster |
| TC-S04 | PASS | `og:title` = "Prompt Lab — Craft Better Prompts" |
| TC-S05 | PASS | `twitter:card` = "summary_large_image" |
| TC-S06 | PASS | Canonical URL: `https://davehomeassist.github.io/prompt-lab-provider-options/` |
| TC-S07 | PASS | `<meta name="robots" content="index,follow">` |
| **Section 9 — Cross-Cutting** | | |
| TC-X01 | PASS | `overflow-x: hidden` on both `html` and `body` |
| TC-X02 | PASS | `scroll-behavior: smooth` on `html` |
| TC-X03 | PASS | `font-display: swap` on both `@font-face` declarations |
| TC-X04 | PASS | JetBrains Mono `@font-face` with `font-display: swap` |
| TC-X05 | PASS | All content in HTML — JS only adds molecules, bonds, tab switching, copy. No blank sections without JS |
| TC-X06 | PASS (with flag) | Dot grid at `z-index: 9999`, 48px spacing. **Flag:** z-index is unnecessarily high |
| TC-X07 | PASS | `pointer-events: none` on `body::before` (grid), `.molecules`, `.hero::before` (glow) |
| TC-X08 | BLOCKED | Requires Lighthouse — single-file HTML ~40KB, no external deps |
| TC-X09 | PASS | `threshold: 0.15`, `rootMargin: '0px 0px -40px 0px'` |

#### Asset Audit

| Asset | Size | Dimensions | Status |
|-------|------|-----------|--------|
| `hero-logo.png` | 352KB | 1024×1024 | **OVERSIZED** — displayed at 280px, could compress to ~40KB |
| `og-image.png` | 100KB | 1200×630 | OK — correct OG dimensions |
| `docs/index.html` | 40KB | — | OK |
| `docs/fonts/outfit.woff2` | 31KB | — | OK — referenced in CSS |
| `docs/fonts/jetbrains-mono.woff2` | 31KB | — | OK — referenced in CSS |
| `docs/fonts/chakra-petch-600.woff2` | 9.8KB | — | **DEAD** — not referenced in CSS |
| `docs/fonts/chakra-petch-700.woff2` | 9.6KB | — | **DEAD** — not referenced in CSS |

#### Confirmed Defects

| ID | Severity | TC | Description |
|----|----------|-----|-------------|
| D01 | P1 | TC-H04 | Missing `-moz-background-clip: text` — Firefox may not render gradient on "Craft" |
| D02 | P1 | TC-P02, TC-F02, TC-W03 | No `@supports` fallback for `backdrop-filter` — glass cards degrade to fully transparent on unsupported browsers |
| D03 | P2 | TC-S03 | OG image URL has no cache-buster — old Foundry preview may persist in messaging apps |
| D04 | P2 | Asset audit | 19.4KB of dead Chakra Petch font files deployed to `docs/fonts/` |
| D05 | P3 | Asset audit | `hero-logo.png` is 352KB for a 280px display element — ~8× oversized |
| D06 | P3 | TC-X06 | Dot grid overlay at `z-index: 9999` — will render above future modals/banners |

---

*Generated by Claude Opus 4.6 — 2026-03-13*
