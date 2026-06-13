const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sections = [...document.querySelectorAll('main section[id]')];
const navLinks = [...document.querySelectorAll('.site-nav a')];
const navToggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.site-nav');
const demoRun = document.querySelector('[data-demo-run]');
const demoOutput = document.querySelector('[data-demo-output]');
const copyButtons = [...document.querySelectorAll('[data-copy-button]')];

const samples = [
  `$ npm run forecast\n✓ loaded 28 days of usage data\n✓ raw reports preserved in raw_reports\n→ projected month-end burn: 78%\n→ risk: within budget`,
  `$ npm run check\n✓ 1 enterprise configured\n✓ 4 reports synced\n→ latest report: 2026-06-13\n→ raw audit trail intact`,
  `$ npm run classify\n✓ Platform Engineering: extreme\n✓ Data Science: high\n✓ Internal Tools: medium\n→ no budget writes performed`,
];

let sampleIndex = 0;

function setActiveSection(id) {
  navLinks.forEach((link) => {
    const isActive = link.getAttribute('href') === `#${id}`;
    if (isActive) {
      link.setAttribute('aria-current', 'location');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!isOpen));
    nav.toggleAttribute('data-open', !isOpen);
  });
}

navLinks.forEach((link) => {
  link.addEventListener('click', () => {
    if (!navToggle || !nav) {
      return;
    }

    if (window.innerWidth < 900) {
      navToggle.setAttribute('aria-expanded', 'false');
      nav.removeAttribute('data-open');
    }
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        setActiveSection(entry.target.id);
      }
    });
  },
  {
    rootMargin: '-35% 0px -50% 0px',
    threshold: 0.15,
  }
);

sections.forEach((section) => observer.observe(section));

if (demoRun && demoOutput) {
  demoRun.addEventListener('click', () => {
    sampleIndex = (sampleIndex + 1) % samples.length;
    demoOutput.textContent = samples[sampleIndex];
  });
}

copyButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const container = button.closest('.code-block');
    const code = container?.querySelector('code');

    if (!code) {
      return;
    }

    try {
      await navigator.clipboard.writeText(code.textContent ?? '');
      button.classList.add('is-copied');
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.classList.remove('is-copied');
        button.textContent = 'Copy';
      }, 1500);
    } catch {
      button.textContent = 'Copy failed';
      window.setTimeout(() => {
        button.textContent = 'Copy';
      }, 1500);
    }
  });
});

if (prefersReducedMotion) {
  document.documentElement.style.scrollBehavior = 'auto';
}
