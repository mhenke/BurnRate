# BurnRate

## Register

product

## Users

Engineering leaders and platform teams managing GitHub Copilot Enterprise deployments. Users operate in a monitoring/oversight context—reviewing usage dashboards, tracking budget consumption, and making allocation decisions. Primary job: know your Copilot burn rate before GitHub's month-end billing surprise.

## Product Purpose

BurnRate provides observe-only visibility into GitHub Copilot usage without enforcement or automation. It ingests daily usage reports, stores raw payloads for audit history, and produces simple burn forecasts. Success means engineering leaders can answer "How much of our Copilot budget have we used?" and "Will we exceed our limit this month?" with confidence, before the billing cycle closes.

## Brand Personality

**Technical, restrained, trustworthy.** Three words: *precise, quiet, professional.* Voice is direct and data-driven—no marketing fluff, no gamification. Tone matches the Linear aesthetic: dense technical documentation, dark surfaces, single accent color used sparingly. This is infrastructure tooling, not a consumer app.

## Anti-references

- SaaS landing page templates with gradient text, animated hero metrics, and "AI-powered" buzzwords
- Gamified dashboards with confetti, progress bars with emoji, or celebratory animations
- Warm cream/beige "editorial" backgrounds—the default 2026 AI aesthetic
- Glassmorphism, neumorphism, or decorative blur effects
- Card grids with identical icon + heading + text patterns
- Tiny uppercase tracked eyebrows above every section ("ABOUT", "PROCESS", "PRICING")

## Design Principles

1. **Observe, don't intervene**: This tool monitors; it doesn't enforce. UI should reflect passive visibility, not control panels or automation dashboards.

2. **Data density over whitespace**: Technical users prefer information-rich displays. Favor tabular data, compact metrics, and drill-down capability over spacious marketing layouts.

3. **Dark mode as default**: Engineers use these tools in low-light environments (terminals, IDEs, late-night incident review). Dark surfaces reduce eye strain and match the developer tool ecosystem.

4. **Single accent, restrained use**: One brand color (lavender-blue #5e6ad2) used for focus states, critical CTAs, and brand marks only. Never decorative.

5. **Audit trail first**: Raw data preservation is a core value. Every transformation is traceable back to the source payload. UI should expose this lineage when relevant.

## Accessibility & Inclusion

- WCAG 2.2 AA compliance for all interactive surfaces
- Color contrast ≥4.5:1 for body text, ≥3:1 for large text
- Reduced motion support via `prefers-reduced-motion` media query
- Keyboard navigation for all interactive elements
- Screen reader compatibility for data tables and metrics
