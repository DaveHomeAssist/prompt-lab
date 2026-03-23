# Prompt Lab — Project Specification

## 1. Summary

**Purpose:** Multi-surface prompt engineering workbench — create, test, compare, and manage LLM prompts across 5 providers (Anthropic, OpenAI, Gemini, OpenRouter, Ollama).

**Status:** v1.7.0 live. Landing at promptlab.tools, hosted app at prompt-lab-tawny.vercel.app/app/. Main branch integrated and pushed. Feature-complete but needs clarity and consolidation pass.

---

## 2. Objectives (New Abilities)

### Collapsible Sections
- Right rail (library detail, run history) collapses to icon-only rail at narrow widths
- Settings panel collapses into modal on mobile
- Advanced filters hidden behind disclosure in library view

### Accordion Rules
- Single-open for provider settings (one provider expanded at a time)
- Multi-open for prompt metadata sections (tags, notes, variants)
- Persistence: accordion state stored in sessionStorage per view

### Keyboard Navigation
- Enter to toggle accordion headers
- Arrow keys to move between headers within a group
- Tab to advance between interactive elements
- Escape to close modals, drawers, and expanded panels

### Contrast & Accessibility
- Audit text tokens: `--text`, `--text-dim`, `--placeholder`, `--disabled`
- Verify focus ring visibility on every interactive surface
- Check icon and border contrast for buttons, inputs, pills, nav items
- Document approved pairs in theme resource
- **Current gaps:** Issues 019-022 (WCAG audit, type scale, panel width) — deferred P3

### Nav Bar Logic
- Active state: match on route group (`/app/create`, `/app/library`), not leaf path
- Deep link behavior: `/app/create?prompt=ID` loads prompt into editor
- Mobile: collapse to hamburger menu at 700px
- No duplicate destinations across top nav and sidebar

### Column Layouts
- Presets: 1-col (mobile), 2-col (editor + results), 3-col (library + editor + detail)
- Breakpoints: 900px (3→2 col), 700px (2→1 col), 600px (compact mobile)
- One scroll container per view — no nested scroll traps
- Sidebar: fixed width 280px, collapsible to 48px icon rail

### Theme Resource
- Single source for tokens: `bg0`–`bg3`, text tiers, borders, focus rings
- Component recipes: callouts, pills, nav items, panels, modals
- Style drift prevention: documented Do/Don't list
- Current palette: dark mode primary (`#0d0d0f` bg, `#a78bfa` accent)

### Run Agent (Blank State)
- New page shows: provider selector, model picker, empty prompt editor, "Start typing" placeholder
- Empty selection: library shows "No prompts yet — create one" with CTA
- Empty runs: timeline shows "Run a prompt to see results here"

### Inputs/Outputs
- Page context: current view, selected prompt, active provider
- Selected blocks: prompt text, system message, variants, test cases
- Implementation: patch lists as atomic commits, PR-ready notes

### Execution
- Convert plan steps into tasks with owners
- Track patches as atomic commits
- Cleanup: remove dead tokens, unused CSS, normalize spacing/radii
- **Active partial issues (011-018):** Create density, library jitter, experiments/history split, icon labeling, save workflows, drawer actions, auto-save clarity, composer entry points

---

## 3. Project Metadata

| Field | Value |
|-------|-------|
| Project Name | Prompt Lab |
| Epic / Track | UI + WEB + EXTENSION + DOCS |
| Owner | Dave Robertson |
| Status | IN PROGRESS |
| Priority | HIGH |
| Target Ship | Consolidation pass before next feature work |
| Source of Truth | CLAUDE.md (issue tracker), ARCHITECTURE.md (technical), CURRENT_PROJECT_REPORT.md (status) |

---

## 4. Definition of Done (DoD)

- [ ] Meets nav + theme rules (active states, no duplicate routes, mobile collapse)
- [ ] No contrast regressions (4.5:1 text, 3:1 UI components)
- [ ] Keyboard navigation works (all interactive elements reachable)
- [ ] Mobile layout verified (1-col at 700px, touch targets 44px+)
- [ ] Docs updated if behavior changed (DOCS_INVENTORY.md in same commit)

---

## 5. Overview & Scope

**Problem:** Feature coverage is broad but UX is dense and fragmented. Create workflow is vertically stacked. Experiments and run history are split across surfaces. Onboarding story is unclear for new users. Hosted web still feels secondary to extension.

**Goal:** Simplify Create workflow, unify experiments/run-history, clarify onboarding, make hosted web first-class.

**Success Metrics:**
- Create-to-first-run path takes < 3 clicks
- Single surface for experiments and run history
- New user understands what to do in < 10 seconds
- Web app has feature parity with extension (minus chrome.storage)

**In Scope:**
- Create/Editor UX consolidation (issue 002)
- Experiments/history unification (issue 013)
- Library detail stabilization (issue 003)
- Nav and theme audit
- Landing page alignment with promptlab.tools identity

**Out of Scope:**
- New provider integrations
- Backend/auth system
- Monetization
- Native mobile app

**Constraints:** Local-first, BYOK (bring your own key), Browser MV3 / Tauri 2 / Vercel web, zero public backend except CORS proxy.

---

## 6. UX/UI & Navigation Logic

### UI Elements
- Nav bar (top), Sidebar (library list), Prompt editor, Results panel, Run timeline, Filters toolbar, Settings modal, Provider selector

### States to Validate
| State | Where |
|-------|-------|
| Empty | Library (no prompts), Runs (no results), Editor (blank) |
| Loading | Provider call in flight, library loading |
| Error | API key invalid, provider timeout, network failure |
| Selected | Prompt in library, run in timeline |
| Hover | Nav items, library rows, action buttons |
| Focus | All interactive elements (visible ring) |
| Disabled | Run button without provider, save without changes |

### Nav Regression Checklist
- [ ] Active state matches current route group
- [ ] No duplicate routes across nav surfaces
- [ ] Deep link lands with correct context loaded
- [ ] Mobile nav collapses intentionally (hamburger at 700px)

---

## 7. Theme & Contrast Targets

| Element | Target Ratio | Current Status |
|---------|-------------|----------------|
| Normal text | >= 4.5:1 | Partial (issues 019, 021) |
| Large text (18px+) | >= 3:1 | Pass |
| UI components (borders, icons) | >= 3:1 | Needs audit |
| Focus ring visibility | Visible on all surfaces | Needs audit |
| Approved pairs | Documented in theme resource | Not yet created |

---

## 8. Risks & Acceptance Checks

### Risks
1. **Open CORS proxy** — `Access-Control-Allow-Origin: *`, no rate limiting. Fine at current scale, liability at growth.
2. **Vite version split** — Extension on 7.3.1, web/desktop on 8.0.0. Silent build divergence risk.
3. **Doc governance drift** — New extension docs tree untracked, DOCS_INVENTORY not updated.
4. **Node version** — Project declares 22.x, local machine runs 25.8.1, pages.yml uses 20.
5. **Create workflow density** — Issue 002 partially addressed but not fully resolved.

### Open Questions
1. Should hosted web get its own custom domain for `/app/` (not just Vercel subdomain)?
2. Should experiments and run history merge into a single timeline or tabbed view?
3. Is desktop (Tauri) actively distributed or just build-ready?

### Acceptance Checks
- **Functional:** Primary behavior works; no regressions in create/run/save/library flows
- **A11y:** Keyboard flows complete, focus rings visible, contrast pairs pass
- **Performance:** No console errors, no jank, sub-2s initial load

---

## 9. Implementation & Release

### Plan
1. Align Vite to 8.0.0 across all packages
2. Fix pages.yml Node version (20 → 22)
3. Create/Editor UX consolidation (issue 002)
4. Experiments/history unification (issue 013)
5. Library detail stabilization (issue 003)
6. Nav and theme contrast audit (issues 019-022)
7. Commit new extension docs structure + update DOCS_INVENTORY.md
8. Delete duplicate files (script-agent 2.html artifacts)

### QA
- Desktop: Chrome extension side panel, standalone Tauri window
- Mobile: responsive web at 375px, 428px widths
- Keyboard-only: full create/run/save flow without mouse

### Release Notes
- v1.7.0: Brand refresh, landing page rebuild, main branch integrated, Script Agent fixes merged

### Rollback
- Trigger: broken create/run flow, API proxy failure, or extension crash
- Steps: `git revert HEAD` for last merge, redeploy via Vercel dashboard
