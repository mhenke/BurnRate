# BurnRate GitHub Pages Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single-page GitHub Pages site for BurnRate using plain HTML/CSS/JS, with a dark Linear-style visual system, polished interactive navigation, copyable code snippets, and a GitHub Actions deployment workflow.

**Architecture:** Keep the site dependency-free and static. Use one semantic HTML entrypoint in `docs/index.html`, one stylesheet in `docs/styles.css`, and one script in `docs/main.js`. The HTML owns content and structure, CSS owns the design tokens and responsive layout, and JS owns lightweight behaviors only: smooth scroll, active-section tracking, copy-to-clipboard, mobile nav toggle, and a small hero terminal demo.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, GitHub Pages, GitHub Actions.

---

### Task 1: Build the single-page site shell and content

**Files:**
- Create: `docs/index.html`
- Create: `docs/styles.css`
- Create: `docs/main.js`

- [ ] **Step 1: Write the page structure**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BurnRate — Know your Copilot burn before GitHub does</title>
    <meta name="description" content="BurnRate ingests GitHub Copilot usage reports, stores raw payloads for audit history, and produces burn forecasts." />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header" data-header>
      <div class="container header-inner">
        <a class="brand" href="#top" aria-label="BurnRate home">
          <span class="brand-mark">B</span>
          <span class="brand-text">BurnRate</span>
        </a>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
        <nav class="site-nav" id="site-nav" aria-label="Primary">
          <a href="#features">Features</a>
          <a href="#quick-start">Quick start</a>
          <a href="#architecture">Architecture</a>
          <a href="#configuration">Configuration</a>
          <a href="#commands">Commands</a>
        </nav>
      </div>
    </header>

    <main id="main">
      <section class="hero section" id="top">
        <div class="container hero-grid">
          <div class="hero-copy">
            <p class="kicker">GitHub Copilot visibility</p>
            <h1>Know your Copilot burn before GitHub does.</h1>
            <p class="lede">BurnRate ingests usage reports, stores raw JSON for audit history, and turns daily data into simple forecasts and budget alerts. Observe only. No budget writes.</p>
            <div class="button-row">
              <a class="button button-primary" href="#quick-start">Quick start</a>
              <a class="button button-secondary" href="https://github.com/mhenke/BurnRate" rel="noreferrer">View on GitHub</a>
            </div>
          </div>

          <div class="terminal" data-terminal>
            <div class="terminal-head">
              <span>BurnRate demo</span>
              <button class="terminal-action" type="button" data-demo-run>Run sample</button>
            </div>
            <pre><code data-demo-output>$ npm run forecast
✓ loaded 28 days of usage data
✓ raw reports preserved in raw_reports
→ projected month-end burn: 78%
→ risk: within budget</code></pre>
          </div>
        </div>
      </section>

      <section class="section" id="features">
        <div class="container">
          <h2>What it does</h2>
          <div class="feature-grid">
            <article class="panel">
              <h3>Raw-first storage</h3>
              <p>Stores the source payload before parsing so schema changes do not erase history.</p>
            </article>
            <article class="panel">
              <h3>Forecasts</h3>
              <p>Summarizes Copilot usage patterns into simple burn projections and month-end risk.</p>
            </article>
            <article class="panel">
              <h3>Budget alerts</h3>
              <p>Tracks thresholds and notifications without mutating GitHub budget settings.</p>
            </article>
            <article class="panel">
              <h3>Dual databases</h3>
              <p>PostgreSQL in production. SQLite for local development and tests.</p>
            </article>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>
```

- [ ] **Step 2: Apply the design tokens and layout rules**

```css
:root {
  --canvas: #010102;
  --surface-1: #0f1011;
  --surface-2: #141516;
  --ink: #f7f8f8;
  --ink-muted: #d0d6e0;
  --ink-subtle: #8a8f98;
  --primary: #5e6ad2;
  --primary-hover: #828fff;
  --primary-focus: #5e69d1;
  --hairline: #23252a;
  --hairline-strong: #34343a;
}

html {
  scroll-behavior: smooth;
  color-scheme: dark;
}

body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font: 400 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.container {
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.section {
  padding: 96px 0;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.panel,
.terminal {
  background: var(--surface-1);
  border: 1px solid var(--hairline);
  border-radius: 12px;
}
```

- [ ] **Step 3: Add the interactive behaviors**

```js
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sections = [...document.querySelectorAll('main section[id]')];
const navLinks = [...document.querySelectorAll('.site-nav a')];
const navToggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.site-nav');
const demoRun = document.querySelector('[data-demo-run]');
const demoOutput = document.querySelector('[data-demo-output]');

navToggle?.addEventListener('click', () => {
  const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
  navToggle.setAttribute('aria-expanded', String(!isOpen));
  nav.toggleAttribute('data-open', !isOpen);
});

navLinks.forEach((link) => {
  link.addEventListener('click', () => {
    if (window.innerWidth < 900) {
      navToggle?.setAttribute('aria-expanded', 'false');
      nav?.removeAttribute('data-open');
    }
  });
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navLinks.forEach((link) => {
      link.toggleAttribute('aria-current', link.getAttribute('href') === `#${entry.target.id}`);
    });
  });
}, { rootMargin: '-40% 0px -50% 0px', threshold: 0.1 });

sections.forEach((section) => observer.observe(section));

demoRun?.addEventListener('click', () => {
  if (!demoOutput) return;
  demoOutput.textContent = prefersReducedMotion
    ? `$ npm run forecast\n✓ projected month-end burn: 78%\n→ risk: within budget`
    : `$ npm run forecast\n✓ loaded 28 days of usage data\n✓ raw reports preserved in raw_reports\n→ projected month-end burn: 78%\n→ risk: within budget`;
});
```

- [x] **Step 4: Verify the HTML is semantic and accessible**

Run:
```bash
npx vite --host
```

Expected: the page loads locally, nav links scroll to each section, focus rings are visible, and the hero demo button updates the terminal copy.

- [ ] **Step 5: Commit**

```bash
git add docs/index.html docs/styles.css docs/main.js
git commit -m "feat: add GitHub Pages site shell"
```

### Task 2: Add GitHub Pages deployment

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Add the Pages workflow**

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - '.github/workflows/pages.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./docs
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Verify the workflow shape**

Run:
```bash
git status --short
```

Expected: only the new docs files and workflow file are listed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy docs to GitHub Pages"
```

### Task 3: Final verification and repo link-up

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the published site link**

```md
## Site

BurnRate site: https://mhenke.github.io/BurnRate/
```

- [ ] **Step 2: Verify links and content**

Run:
```bash
npm test
```

Expected: existing tests still pass, and the static site changes do not affect the CLI/runtime code.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: link BurnRate pages site"
```
