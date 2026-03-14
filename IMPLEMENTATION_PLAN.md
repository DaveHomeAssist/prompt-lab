# Prompt Lab — v1.6.0 Execution Tracker

**Date:** 2026-03-14
**Version:** 1.5.0 → 1.6.0
**Status:** All workstreams complete. One manual item remaining (demo recording).

---

## Project Summary

Prompt Lab is a multi-provider prompt engineering workbench that runs as a Chrome extension, desktop app (Tauri), and web app (Vercel). It supports Anthropic, OpenAI, Gemini, OpenRouter, and Ollama from a single UI with credential isolation, one-click enhance, A/B testing, prompt composition, a taggable library, ghost variables, test cases, and eval history.

**The gap was visibility, not features.** v1.6.0 closes that gap with version history UX, a conversion-ready landing page, and a distribution launch kit.

---

## Workstream 1: Version History UI — COMPLETE

**Goal:** Surface the existing versioning system so users can see, compare, and annotate prompt evolution.

| Task | Status | Notes |
|------|--------|-------|
| 1.1 Version Timeline Panel | ✅ Done | Already existed in codebase |
| 1.2 Inline Diff View | ✅ Shipped | Word-level diff with toggle per version |
| 1.3 Change Notes on Save | ✅ Shipped | "What changed?" input in save dialog |
| 1.4 Version Count Badge | ✅ Done | Already existed in codebase |

**Files modified:**
- `App.jsx` — change note input in save dialog, version timeline trigger
- `promptSchema.js` — schema already supported, no changes needed
- `usePromptLibrary.js` — API already existed, no changes needed

---

## Workstream 2: Landing Page Conversion — COMPLETE (1 manual item)

**Goal:** Make the landing page at promptlab.tools accurately represent the product and convert visitors into users.

| Task | Status | Notes |
|------|--------|-------|
| 2.1 Demo GIF/WebM | ⏳ Manual | Needs screen recording — 15s loop of enhance → A/B test flow |
| 2.2 Hero Copy | ✅ Done | Already correct — "on the web or as a Chrome extension" |
| 2.3 GitHub Stars Badge | ✅ Shipped | Static badge + stats section |
| 2.4 Feature Card Swap | ✅ Shipped | Replaced "Side Panel Mode" with "Template Variables" |
| 2.5 Social Proof | ✅ Shipped | "5 providers · 50+ models" |
| 3.4 SEO Keywords | ✅ Shipped | Meta description + section headings updated |

**Recording spec for 2.1:**
- Source: web app at `/app/`
- Resolution: 1280×800, crop to panel
- Flow: type prompt → Enhance → result → A/B tab → compare two models
- Format: WebM primary, GIF fallback (`<video autoplay loop muted playsinline>`)
- Size: under 2MB
- Placement: hero section, between sub-copy and CTA buttons

---

## Workstream 3: Distribution Push — COMPLETE

**Goal:** Get the tool in front of developer communities.

| Task | Status | Location |
|------|--------|----------|
| 3.1 Shareable Templates (×3) | ✅ Shipped | `public/templates/` |
| 3.2 Show HN Draft | ✅ Staged | `distribution/show-hn-draft.md` |
| 3.3 Reddit Drafts (×2) | ✅ Staged | `distribution/reddit-localllama-draft.md`, `distribution/reddit-prompt-engineering-draft.md` |

**Templates created:**
- Code Review System Prompt — uses `{{clipboard}}`, `{{datetime}}`
- Technical Writing Assistant — multi-variant with tone options
- API Documentation Generator — structured with test cases

---

## Additional v1.6.0 Work (not in original plan)

| Feature | Status | Branch |
|---------|--------|--------|
| Multi-pad scratchpad | ✅ Shipped | `main` |
| Ghost Variables (`{{date}}`, `{{time}}`, `{{clipboard}}`) | ✅ Shipped | `main` |
| Golden Response Benchmark | ✅ Shipped | `main` |
| Import schema aliases (`prompt`→`enhanced`, `description`→`notes`, `category`→`collection`) | ✅ Shipped | `main` |
| Public demo mode (server-side key injection + rate limiting) | ✅ Shipped | `feature/public-demo-mode` |
| Setup guide page (`/setup`) | ✅ Shipped | `feature/public-demo-mode` |
| Privacy policy page (`/privacy`) | ⏳ Pending | Not yet saved to repo |
| Platform strategy docs (ARCHITECTURE.md, ROADMAP.md) | ✅ Shipped | `main` |
| Notion project brief + tracker updates | ✅ Done | External (Notion MCP) |

---

## What's NOT in Scope

| Feature | Why Deferred |
|---------|-------------|
| Provider Chaining (micro-workflows) | High complexity, scope creep, save for v2.0 |
| Team Playbooks | Requires backend, violates zero-backend rule |
| Semantic diff (embedding-based) | Over-engineered for v1.6 — text diff is sufficient |
| Product Hunt launch | Save for a bigger release (v2.0 with chaining) |

---

## Remaining Items

1. **Record demo GIF/WebM** (manual) — 15s screen recording for landing page hero
2. **Save privacy policy HTML** to `prompt-lab-web/public/privacy.html`
3. **Merge `feature/public-demo-mode`** into `main` when ready to go live
4. **Add Vercel env vars** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`) before pushing public demo mode
5. **Set provider spend caps** in Anthropic/OpenAI/Google dashboards before public launch
6. **Post Show HN + Reddit** after demo recording is on the landing page

---

## Success Metrics

| Metric | Current | Target (30 days post-launch) |
|--------|---------|------------------------------|
| GitHub stars | ? | +100 |
| Weekly active web app users | ? | 200 |
| Library entries with 2+ versions | 0% (feature was invisible) | 30% of saved prompts |
| Landing page → app click-through | Unknown | 15% |
| Share URL generations | ~0 | 50/week |
