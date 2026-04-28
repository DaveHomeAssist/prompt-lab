# Prompt Lab UX/UI Bold Restructure Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first bold UX/UI slice that aligns the landing page and in-app shell around a shared Prompt Lab brand system and a clearer Workbench / Library / Evaluate mental model.

**Architecture:** This slice keeps Prompt Lab's existing frontend and deploy model intact. The work focuses on shared visual tokens, app-shell hierarchy, landing conversion copy/layout, and minimal test updates to protect the shell-level behavior. The slice intentionally avoids deep internal rewrites of Library and Evaluate so both surfaces can move together without destabilizing core workflows.

**Tech Stack:** React, Vite, Vitest, vanilla HTML/CSS/JS, Tailwind utility classes, single-file landing page authoring

---

## File structure

### New docs

- `prompt-lab-source/docs/uxui-bold-restructure-spec.md`
  - redesign source of truth for the overall UX/UI pass
- `prompt-lab-source/docs/uxui-bold-restructure-plan.md`
  - implementation plan for slice 1

### Files to modify in slice 1

- `prompt-lab-source/prompt-lab-extension/src/AppHeader.jsx`
  - app-shell naming, hierarchy, and top-nav presentation
- `prompt-lab-source/prompt-lab-extension/src/tests/AppHeader.test.jsx`
  - protects shell labels and subview behavior
- `prompt-lab-source/prompt-lab-extension/src/index.css`
  - shared app-shell brand tokens and shell-level styling adjustments
- `prompt-lab-source/prompt-lab-extension/src/constants.js`
  - shared theme token changes where shell surfaces read from `T`
- `prompt-lab-source/prompt-lab-web/index.html`
  - landing conversion pass and workflow-based restructuring
- `prompt-lab-source/DOCS_INVENTORY.md`
  - register the new active docs

## Task 1: Add the redesign docs

**Files:**

- Create: `prompt-lab-source/docs/uxui-bold-restructure-spec.md`
- Create: `prompt-lab-source/docs/uxui-bold-restructure-plan.md`
- Modify: `prompt-lab-source/DOCS_INVENTORY.md`

- [ ] **Step 1: Write the docs and register them**

Add the spec and plan documents, then register them under active internal technical docs in `prompt-lab-source/DOCS_INVENTORY.md`.

Use this inventory row format:

```md
| `docs/uxui-bold-restructure-spec.md` | UX/UI redesign spec | Active | Bold cross-surface UX/UI restructuring spec covering landing conversion, app-shell coherence, and phased execution. |
| `docs/uxui-bold-restructure-plan.md` | UX/UI slice 1 plan | Active | Task-by-task implementation plan for the first cross-surface redesign slice. |
```

- [ ] **Step 2: Run a targeted lint on the docs**

Run:

```bash
node .\\node_modules\\markdownlint-cli2\\markdownlint-cli2-bin.mjs --no-globs "DOCS_INVENTORY.md" "docs/uxui-bold-restructure-spec.md" "docs/uxui-bold-restructure-plan.md"
```

Expected:

```text
Summary: 0 error(s)
```

- [ ] **Step 3: Commit the docs**

Run:

```bash
git add prompt-lab-source/DOCS_INVENTORY.md prompt-lab-source/docs/uxui-bold-restructure-spec.md prompt-lab-source/docs/uxui-bold-restructure-plan.md
git commit -m "docs: add Prompt Lab UX/UI restructure spec"
```

## Task 2: Protect the shell change with failing tests

**Files:**

- Modify: `prompt-lab-source/prompt-lab-extension/src/tests/AppHeader.test.jsx`
- Test: `prompt-lab-source/prompt-lab-extension/src/tests/AppHeader.test.jsx`

- [ ] **Step 1: Write the failing test for the new workspace label**

Update the first test to protect the new primary shell naming:

```jsx
it('shows Workbench, Library, and Evaluate as the primary workspaces', () => {
  renderHeader();

  expect(screen.getByRole('tab', { name: 'Workbench' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Library' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Evaluate' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Create' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test --prefix prompt-lab-source/prompt-lab-extension -- src/tests/AppHeader.test.jsx
```

Expected:

```text
FAIL
Unable to find an accessible element with the role "tab" and name "Workbench"
```

- [ ] **Step 3: Add a second failing assertion for the upgraded header copy**

Extend the test file with:

```jsx
it('shows a workbench-oriented utility label instead of the old create workbench copy', () => {
  renderHeader();

  expect(screen.getByText('Prompt engineering workbench')).toBeInTheDocument();
  expect(screen.queryByText('Create workbench')).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run the test again to verify it fails for the expected reason**

Run:

```bash
npm test --prefix prompt-lab-source/prompt-lab-extension -- src/tests/AppHeader.test.jsx
```

Expected:

```text
FAIL
Unable to find an element with the text: Prompt engineering workbench
```

## Task 3: Implement the app-shell header restructure

**Files:**

- Modify: `prompt-lab-source/prompt-lab-extension/src/AppHeader.jsx`
- Modify: `prompt-lab-source/prompt-lab-extension/src/index.css`
- Modify: `prompt-lab-source/prompt-lab-extension/src/constants.js`
- Test: `prompt-lab-source/prompt-lab-extension/src/tests/AppHeader.test.jsx`

- [ ] **Step 1: Update the visible primary workspace label from Create to Workbench**

In `AppHeader.jsx`, change the primary workspace button list to:

```jsx
{[
  ['create', 'Workbench'],
  ['library', 'Library'],
  ['evaluate', 'Evaluate'],
].map(([id, label]) => (
```

Keep the internal routing target as `create`; only the visible product label changes in this slice.

- [ ] **Step 2: Replace the old utility copy with the new shell framing**

In `AppHeader.jsx`, replace the `utilityCopy` logic with:

```jsx
const utilityCopy = primaryView === 'notebook'
  ? 'Scratchpad and working notes'
  : activeSection === 'create'
    ? 'Prompt engineering workbench'
    : activeSection === 'evaluate'
      ? 'Compare runs and judge outcomes'
      : 'Saved prompts, versions, and reuse';
```

- [ ] **Step 3: Upgrade the header styling to the shared ember/gold direction**

In `AppHeader.jsx`, replace the current violet-heavy active styles with ember-led shell classes:

```jsx
const activeTabClass = 'border border-orange-400/50 bg-orange-500/15 text-orange-50 shadow-[0_0_0_1px_rgba(251,146,60,0.12)]';
const inactiveTabClass = `${m.btn} ${m.textAlt}`;
```

Then apply `activeTabClass` to active primary tabs, subview tabs, and the Notebook utility button.

- [ ] **Step 4: Add shared shell tokens in `index.css`**

In `prompt-lab-extension/src/index.css`, replace the current focus vars with:

```css
:root {
  --pl-focus-ring: rgba(251, 146, 60, 0.72);
  --pl-focus-ring-offset: rgba(10, 10, 15, 0.92);
  --pl-brand-ember: #e8512f;
  --pl-brand-ember-bright: #ff6b47;
  --pl-brand-gold: #c4a44a;
  --pl-brand-paper: #f0ede6;
  --pl-brand-ink: #06060a;
}
```

Also add shell helpers:

```css
.pl-brand-title {
  font-family: 'Instrument Serif', Georgia, serif;
  letter-spacing: -0.02em;
}

.pl-brand-chip {
  border: 1px solid rgba(232, 81, 47, 0.28);
  background: rgba(232, 81, 47, 0.1);
  color: var(--pl-brand-paper);
}
```

- [ ] **Step 5: Tune the shared theme tokens in `constants.js`**

Update the dark theme object in `T.dark` so shell surfaces lean toward the landing palette:

```js
dark: {
  bg: 'bg-[#06060a]',
  surface: 'bg-[#101018]',
  border: 'border-white/10',
  borderHov: 'hover:border-white/20',
  input: 'bg-[#14141d] border-white/10',
  text: 'text-[#f0ede6]',
  textSub: 'text-[#b3afaa]',
  textMuted: 'text-[#7c7a76]',
  textBody: 'text-[#d7d2cb]',
  textAlt: 'text-[#c7c2bb]',
  btn: 'bg-white/[0.04] hover:bg-white/[0.08]',
  header: 'bg-[#0a0a0f]/95 backdrop-blur-sm border-white/10',
  ...
}
```

Keep semantic success/diff colors intact.

- [ ] **Step 6: Run the header test to verify it passes**

Run:

```bash
npm test --prefix prompt-lab-source/prompt-lab-extension -- src/tests/AppHeader.test.jsx
```

Expected:

```text
PASS
3 tests passed
```

## Task 4: Rewrite the landing around the actual product workflow

**Files:**

- Modify: `prompt-lab-source/prompt-lab-web/index.html`

- [ ] **Step 1: Rewrite the nav and hero CTAs**

Update the nav CTA to `Open PromptLab →`.

Update the hero CTA block to:

```html
<div class="hero-actions">
  <a href="https://promptlab.tools/app" class="btn-primary">
    Open PromptLab
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </a>
  <a href="https://promptlab.tools/setup" class="btn-secondary">Install extension</a>
  <a href="#workflow" class="btn-tertiary">See how it works</a>
</div>
```

- [ ] **Step 2: Rewrite the hero copy around the workflow promise**

Replace the current hero headline/subcopy with:

```html
<h1 class="hero-headline">
  <span>Write sharper prompts.</span>
  <span><span class="hero-italic">Keep the winners.</span></span>
</h1>
<p class="hero-sub">
  Prompt Lab gives you one serious workspace to write, improve, save, and evaluate prompts across Claude, GPT-4o, Gemini, OpenRouter, and local models.
</p>
```

- [ ] **Step 3: Replace the proof-strip labels with trust-building product proof**

Update the four proof labels to:

```html
<div class="proof-label">Enhancement modes</div>
<div class="proof-label">Providers supported</div>
<div class="proof-label">Library-backed workflow</div>
<div class="proof-label">Prompts kept local-first</div>
```

Keep the numeric scaffolding unless it conflicts with the final copy.

- [ ] **Step 4: Reframe the features section into workflow language**

Add an `id="workflow"` anchor to the section and replace the intro block with:

```html
<div class="section-label">Workflow</div>
<h2 class="section-heading">Workbench, Library, Evaluate.</h2>
<p class="section-sub">Prompt Lab is built around one repeatable loop: sharpen the prompt, keep the version that works, and test it against real model output.</p>
```

Then rename the three feature rows:

```html
<div class="feature-tag">Workbench</div>
<h3 class="feature-title">Sharpen the prompt without losing the point</h3>

<div class="feature-tag">Evaluate</div>
<h3 class="feature-title">Compare runs instead of guessing</h3>

<div class="feature-tag">Library</div>
<h3 class="feature-title">Keep the prompts worth reusing</h3>
```

- [ ] **Step 5: Tighten the final CTA**

Update the final CTA copy to:

```html
<h2 class="cta-heading">Build a prompt workflow,<br><em>not a prompt pile.</em></h2>
<p class="cta-sub">Open Prompt Lab on the web, install the extension when you want it beside the page, and keep the prompts that actually earn their place.</p>
```

- [ ] **Step 6: Add a small tertiary button style if needed**

If `btn-tertiary` does not exist, add:

```css
.btn-tertiary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 24px;
  border-radius: 10px;
  color: var(--text-secondary);
  transition: color 0.2s, background 0.2s;
}

.btn-tertiary:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.04);
}
```

## Task 5: Verify the slice

**Files:**

- Test: `prompt-lab-source/prompt-lab-extension/src/tests/AppHeader.test.jsx`
- Verify: `prompt-lab-source/prompt-lab-web/index.html`

- [ ] **Step 1: Run the targeted header regression test**

Run:

```bash
npm test --prefix prompt-lab-source/prompt-lab-extension -- src/tests/AppHeader.test.jsx
```

Expected:

```text
PASS
```

- [ ] **Step 2: Build-confidence sanity check for the landing HTML**

Run:

```bash
git diff -- prompt-lab-source/prompt-lab-web/index.html prompt-lab-source/prompt-lab-extension/src/AppHeader.jsx prompt-lab-source/prompt-lab-extension/src/index.css prompt-lab-source/prompt-lab-extension/src/constants.js
```

Expected:

```text
Diff shows landing CTA/copy restructuring and app-shell branding changes only for the intended slice.
```

- [ ] **Step 3: Run a focused docs lint for the new spec/plan docs**

Run:

```bash
node .\\node_modules\\markdownlint-cli2\\markdownlint-cli2-bin.mjs --no-globs "docs/uxui-bold-restructure-spec.md" "docs/uxui-bold-restructure-plan.md"
```

Expected:

```text
Summary: 0 error(s)
```

- [ ] **Step 4: Commit the slice**

Run:

```bash
git add prompt-lab-source/prompt-lab-extension/src/AppHeader.jsx prompt-lab-source/prompt-lab-extension/src/tests/AppHeader.test.jsx prompt-lab-source/prompt-lab-extension/src/index.css prompt-lab-source/prompt-lab-extension/src/constants.js prompt-lab-source/prompt-lab-web/index.html
git commit -m "feat: align Prompt Lab landing and app shell"
```
