# PromptLab Mobile — Pre-Scoping Memo

**Status:** PRE-SCOPING — informs a real decision later. **Not a commitment to ship.**

**Date:** 2026-04-25
**Owner:** Dave Robertson (product) — review with engineering before any commitment.
**Source:** `claude.ai/design` handoff bundle (hash `327NHn16Wwm_WJNt6zfohA`); chat transcript explicitly framed this as "Pre-scoping — inform a real mobile decision later."
**Prototype location:** [html pages/PromptLab Mobile.html](../../html%20pages/PromptLab%20Mobile.html) — open in a browser, walks through 7 screens in iOS + Android frames side-by-side with live Tweaks (theme / accent / type / cards).

---

## TL;DR

**Recommendation: do not invest in native (iOS / Android) yet.** Build a **mobile-responsive PWA** of the existing web shell first, gated by a 60-day metrics review against three concrete activation gates. If the gates clear, revisit native.

Cost ladder, ranked by risk/value:

| Path | Eng-weeks (rough) | Recurring cost | Reversibility |
|---|---|---|---|
| **PWA** (responsive web + Add to Home Screen) | 3–5 | $0 hosting (Vercel) | Trivial — ship a feature flag |
| **Native via React Native shared bundle** | 8–12 + ongoing release-mgmt | App Store fees + review delays | Hard — public store presence |
| **Native iOS + native Android (Swift / Kotlin)** | 24+ | App Store fees + 2 platform stacks | Very hard — code lives forever |

PWA buys most of the mobile experience (Add to Home Screen, splash, offline cache) at PromptLab's current usage scale without taking on platform commitments. Native earns its weight only when (a) the data shows mobile is a primary surface, not a secondary one, and (b) one of the platform-only flows below justifies the commitment.

---

## What carries cleanly to native (if we ship it)

The seven prototype screens grouped by transferability:

| Screen | Carries to native? | Notes |
|---|---|---|
| **Library** (browse / search) | ✅ Yes | Pure list + search + chips. Works in PWA. Native adds: long-press menus, share sheet receive. |
| **Library detail** (prompt + history) | ✅ Yes | Pure read view. Identical surface across platforms. |
| **Composer** (write + enhance) | ✅ Yes | Text editor + run button. PWA-capable. Native adds: keyboard avoidance polish. |
| **Streaming response** | ✅ Yes | Append-only text stream. Standard SSE/fetch. Identical across platforms. |
| **Pad list** (notebook index) | ✅ Yes | Same shape as Library. |
| **Pad detail** (long-form notes) | ✅ Yes | Textarea with save. PWA-capable. |
| **Voice capture** | ⚠️ Mixed | Web Speech API works on iOS Safari + modern Chrome but degraded compared to native `SFSpeechRecognizer` / `SpeechRecognizer`. Native is meaningfully better. |

**5 of 7 screens are PWA-clean.** Voice and the "share intent" hooks are the only platform-specific affordances.

---

## What does NOT carry — and why it matters

These are the affordances the prototype hand-waves but a real mobile build must answer:

### 1. Quick capture from share sheet (iOS) / share intent (Android)

The prototype shows a mock "received from share sheet" path. **PWA cannot register as a share target on iOS**; on Android it's possible but limited. The strongest version of mobile-PromptLab — "highlight text in any app, share to PromptLab to enhance" — is **native-only on iOS**.

**Decision lever:** if user research surfaces share-sheet capture as a top-3 use case, native (or at least a thin Swift app that bridges to a PWA WebView) jumps in priority.

### 2. Voice input fidelity

`Web Speech API` on iOS Safari has a 60-second hard cap and no background recognition. Native `SFSpeechRecognizer` runs longer and supports on-device models. For one-shot prompts (≤60s) the gap is invisible; for "transcribe a meeting and have PromptLab summarize" the gap matters.

**Decision lever:** if the Pad notebook becomes a primary mobile surface (transcription-driven), native is the right path.

### 3. Background sync / offline draft queue

PWA service workers can cache and queue, but **iOS aggressively evicts non-installed PWAs** (~7 days inactive). Native gets durable storage by default. For users who draft prompts offline (commute, flight), native wins.

**Decision lever:** if mobile MAU shows >20% of sessions in offline mode, native earns its weight.

### 4. Push notifications for completed runs

iOS PWA push is technically supported (since iOS 16.4) but **only after Add to Home Screen** and with notable delivery quirks. Native is the only reliable path for "your background run finished, here's the result" loops.

**Decision lever:** if long-running A/B sweeps from the desktop become a key workflow worth notifying mobile users about, native push is the path.

---

## Three activation gates for the PWA → Native decision

Ship the PWA first. Revisit native if **any one** of these fires within 60 days of PWA launch:

1. **Mobile sessions ≥ 30% of weekly active users.** Below this, mobile is supplementary; above this, it deserves a first-class platform.
2. **Share-sheet capture requested in ≥ 5% of feedback surveys / support tickets.** Counts as a top-tier feature gap.
3. **Pad-on-mobile editing accounts for ≥ 15% of `pad.entry_saved` events.** Indicates the long-form editing flow is real, not aspirational.

If none fire by day 60: stay on PWA, recheck quarterly.
If any fire: scope a React Native build using the existing React tree as the source-of-truth — `LibraryPanel`, `ComposerTab`, `usePromptLibrary` are already framework-portable; the styling layer (Tailwind classes) needs an RN-compatible token system.

---

## Carry-over from existing PromptLab web

What the mobile build inherits free, regardless of path:

- **Library v2 visual presets** (`density / accent / signature` from this branch's Phase 1-5 work) — the `lib/libraryTweaks.js` preset tables and `useLibraryTweaks` hook are framework-agnostic. Mobile can reuse the same preset semantics with a different rendering layer.
- **Prompt Packs schema + validator** (Phase 6) — pure logic, zero DOM dependencies. Mobile can import and validate packs from day one without re-implementation.
- **Storage shape** (`pl2-*` keys) — `localStorage` works in PWA; React Native uses `AsyncStorage` with the same JSON shape (one adapter file).
- **Telemetry events** (`library.tweak_changed`, `library.prompt_loaded` with axes from Phase 4) — same wire format, same warehouse table. Cross-platform funnel analysis works on day one.

What needs new work for any mobile path:

- Touch targets — every button in the existing web Library is ≤32 px high. Native UX guidelines want 44 px minimum. The `expanded` density preset (44 px tall buttons) is the closest baseline; the mobile-specific Tweaks default should use it.
- Modal / sheet patterns — `SettingsModal` is centered; mobile expects bottom sheets. New component, same data flow.
- Navigation — the desktop tab bar doesn't translate. Use the prototype's `PLTabBar` (Library / Compose / Pad / More).
- Provider picker as a native bottom sheet rather than a dropdown.

---

## Mobile prototype is preserved in this repo

The Claude Design handoff prototype is checked in at:

- `prompt-lab/html pages/PromptLab Mobile.html` (single-file, no build step)
- `prompt-lab/html pages/promptlab-mobile/*.jsx` (7 source files: `app`, `screens`, `styles`, `tweaks-panel`, `ios-frame`, `android-frame`, `design-canvas`)

Open the HTML directly in a browser — Tailwind, React, Babel from CDN; no install. Use the Tweaks panel (bottom-right) to toggle theme / accent / type / cards while comparing iOS and Android side-by-side.

This stays in the repo as the reference visual for any future mobile decision. If the gates above fire and a real build kicks off, the prototype is the source of truth for the visual direction.

---

## What's NOT in this memo

- A pixel-perfect spec for either platform.
- A React Native vs Flutter vs native-native tooling decision — that comes when one of the gates fires, not now.
- A mobile-specific privacy / data-residency review — required before app-store submission, deferred until then.
- API rate limit projections under mobile session patterns — rolling-30-day data won't be meaningful until the PWA has been live for a month.

---

## Action items (only if PWA path is picked)

If product agrees with the PWA-first recommendation, the smallest credible scope:

1. Audit the existing web shell's touch-target compliance — file follow-up issues for any < 44 px hit area.
2. Add a `manifest.json` + service worker stub to `prompt-lab-source/prompt-lab-web/` for Add to Home Screen.
3. Verify `localStorage` quotas on iOS Safari (5 MB per origin) accommodate a typical user's library + pack cache.
4. Add a `is.mobile-pwa` telemetry property on app boot so the activation gates above can be measured.
5. Schedule a 60-day check-in to review the three gates against the dataset.

If product wants native instead, none of the above is wasted — points 1, 3, and 4 still apply.

---

## Status block

- **Track:** Mobile (Phase 10 of `implementation-plan-library-v2-and-packs-2026-04-25.md`)
- **Roadmap status:** `Exploratory` (no change). Promotion to `Active delivery` requires one of the activation gates to fire.
- **Decision needed by:** none yet — this memo is informational. Product reviews when convenient.
- **Re-evaluate:** Q3 2026 at the latest, regardless of gate firings.
