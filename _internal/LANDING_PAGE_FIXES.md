# Landing Page Fix Prompt — docs/index.html

Target: `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/docs/index.html`
Agent: **Forge**
Mode: `fix`
Generated: 2026-03-20

---

## Fix 1 — Double-quote typo (bug)

**Line 1255** — `rel="noopener""` has an extra trailing `"`.

```
Find:    rel="noopener"">web app</a>
Replace: rel="noopener">web app</a>
```

---

## Fix 2 — Dead CSS declaration (cleanup)

**Line 196** — `.hero` sets `padding-top: 3.5rem` but line 204 sets `padding: 2rem` which overrides it.

```
Remove line 196:  padding-top: 3.5rem;
Update line 204:  padding: 6rem 2rem 2rem 2rem;
```

The `6rem` top accounts for the fixed nav height so hero content doesn't sit under it.

---

## Fix 3 — Leaked CSS rule (cleanup)

**Line 1033** — `.workflow-step a` sits outside the `@media (max-width: 600px)` block that closes at line 1032. Move it above the `@media` block or into the general section where workflow styles live (after line 831).

```
Move:  .workflow-step a { color: var(--lab-violet-light); }
To:    after .step-content p { ... } block (line ~831)
```

---

## Fix 4 — Contrast pass (accessibility, 6 selectors)

All body text using `--surface-400` is borderline WCAG AA (4.08:1). Bump to `--surface-300` (9.68:1).

```css
/* Each of these: change var(--surface-400) to var(--surface-300) */
.feature-desc      /* line ~611 */
.demo-text p       /* line ~644 */
.step-content p    /* line ~829 */
.final-cta p       /* line ~867 */
```

And bump `.providers-label` from `--surface-500` to `--surface-400`:

```css
.providers-label   /* line ~466: change --surface-500 to --surface-400 */
```

Leave `.cm` (code comments, line 695) as `--surface-600` — intentionally dim by convention.

---

## Fix 5 — Mobile hamburger nav (feature, medium effort)

**Line 1026** — `@media (max-width: 600px)` hides all nav links except the CTA. No hamburger menu exists. On mobile, users cannot reach Features, Guide, Setup, Privacy, or GitHub.

### Implementation

**CSS additions** (inside the `@media (max-width: 600px)` block):

```css
.nav-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: var(--glass-bg);
  color: var(--surface-300);
  font-size: 1.2rem;
  cursor: pointer;
}

.site-nav-links {
  display: none;
  position: fixed;
  top: 56px;
  left: 0;
  right: 0;
  flex-direction: column;
  padding: 1rem;
  gap: 0;
  background: rgba(2, 6, 23, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--glass-border);
}

.site-nav-links.open { display: flex; }

.site-nav-links a {
  display: flex;
  width: 100%;
  padding: 0.75rem 1rem;
  min-height: 44px;
  border-radius: 0;
}

.site-nav-links .nav-cta {
  margin-top: 0.5rem;
  text-align: center;
  justify-content: center;
}
```

**CSS defaults** (outside media query, hide toggle on desktop):

```css
.nav-toggle { display: none; }
```

**HTML** — Add toggle button inside `<nav>`, before `.site-nav-links`:

```html
<button type="button" class="nav-toggle" id="nav-toggle"
        aria-expanded="false" aria-controls="nav-links" aria-label="Menu">
  &#9776;
</button>
```

Add `id="nav-links"` to the `.site-nav-links` div.

**JS** — Add to the script block:

```js
const navToggle = document.getElementById('nav-toggle');
const navLinks = document.getElementById('nav-links');
if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', open);
    navToggle.textContent = open ? '\u2715' : '\u2630';
  });
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.textContent = '\u2630';
    });
  });
}
```

**Remove** from `@media (max-width: 600px)`:
```css
/* DELETE these two lines */
.site-nav-links a:not(.nav-cta) { display: none; }
.site-nav-links .nav-cta { font-size: 0.65rem; padding: 0.5rem 0.85rem; min-height: 44px; }
```

---

## Verification

After applying all fixes:

1. `grep -n 'noopener""' docs/index.html` — expect 0 matches
2. `grep -n 'padding-top: 3.5rem' docs/index.html` — expect 0 matches (in .hero)
3. `grep -n 'surface-400' docs/index.html` — expect only `.wordmark`, `.scroll-indicator`, code `.op` token, and new `.providers-label`
4. Open on mobile viewport (375px) — hamburger visible, all nav links accessible
5. Desktop — no toggle button visible, nav unchanged

---

## Exclusions

- `.cm` code comment color (`--surface-600`) — intentionally dim, standard convention
- `legacyCopyText` deprecation — functional fallback, low priority, no user impact
- `molContainer` null check — element is hardcoded in HTML, no realistic failure path
- Code tab/copy button interaction — architecturally safe, no class overlap
