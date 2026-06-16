const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sections = [...document.querySelectorAll('main section[id]')];
const navLinks = [...document.querySelectorAll('.site-nav a')];
const navToggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.site-nav');
const demoRun = document.querySelector('[data-demo-run]');
const demoOutput = document.querySelector('[data-demo-output]');
const copyButtons = [...document.querySelectorAll('[data-copy-button]')];
const commandSearch = document.getElementById('command-search');
const commandsTable = document.getElementById('commands-table');
const searchStatus = document.getElementById('search-status');

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

function closeMobileNav() {
  if (!navToggle || !nav) {
    return;
  }

  navToggle.setAttribute('aria-expanded', 'false');
  nav.removeAttribute('data-open');
  navToggle.textContent = 'Menu';
}

function trapFocusInNav(e) {
  if (!nav || !navToggle || e.key !== 'Tab') {
    return;
  }

  const focusable = [...nav.querySelectorAll('a[href], button')];
  if (focusable.length === 0) {
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    navToggle.focus();
  } else if (e.shiftKey && document.activeElement === navToggle) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === navToggle) {
    e.preventDefault();
    first.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    navToggle.focus();
  }
}

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
    const nextOpen = !isOpen;
    navToggle.setAttribute('aria-expanded', String(nextOpen));
    nav.toggleAttribute('data-open', nextOpen);
    navToggle.textContent = nextOpen ? 'Close' : 'Menu';

    if (nextOpen) {
      document.addEventListener('keydown', trapFocusInNav);
      nav.querySelector('a')?.focus();
    } else {
      document.removeEventListener('keydown', trapFocusInNav);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navToggle.getAttribute('aria-expanded') === 'true') {
      closeMobileNav();
      document.removeEventListener('keydown', trapFocusInNav);
      navToggle.focus();
    }
  });
}

navLinks.forEach((link) => {
  link.addEventListener('click', () => {
    if (!navToggle || !nav) {
      return;
    }

    if (window.innerWidth < 900) {
      closeMobileNav();
      document.removeEventListener('keydown', trapFocusInNav);
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

let isDemoRunning = false;

if (demoRun && demoOutput) {
  demoRun.addEventListener('click', () => {
    if (isDemoRunning) return;
    isDemoRunning = true;
    demoRun.disabled = true;
    demoRun.style.opacity = '0.5';
    demoRun.style.cursor = 'not-allowed';
    demoOutput.removeAttribute('aria-live');

    sampleIndex = (sampleIndex + 1) % samples.length;
    const fullText = samples[sampleIndex];
    const lines = fullText.split('\n');
    demoOutput.textContent = '';

    let currentLine = 0;
    
    function printNextLine() {
      if (currentLine < lines.length) {
        const line = lines[currentLine];
        if (currentLine === 0) {
          let charIndex = 0;
          const interval = window.setInterval(() => {
            if (charIndex < line.length) {
              demoOutput.textContent += line[charIndex];
              charIndex++;
            } else {
              window.clearInterval(interval);
              demoOutput.textContent += '\n';
              currentLine++;
              window.setTimeout(printNextLine, 300);
            }
          }, prefersReducedMotion ? 1 : 40);
        } else {
          demoOutput.textContent += line + '\n';
          currentLine++;
          window.setTimeout(printNextLine, prefersReducedMotion ? 1 : 200);
        }
      } else {
        isDemoRunning = false;
        demoRun.disabled = false;
        demoRun.style.opacity = '';
        demoRun.style.cursor = '';
        demoOutput.setAttribute('aria-live', 'polite');
        demoOutput.setAttribute('aria-atomic', 'true');
      }
    }

    printNextLine();
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

if (commandSearch && commandsTable) {
  const rows = [...commandsTable.querySelectorAll('tbody tr')];
  commandSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    let visibleCount = 0;

    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      const isVisible = text.includes(query);
      row.style.display = isVisible ? '' : 'none';
      if (isVisible) {
        visibleCount++;
      }
    });

    if (searchStatus) {
      const noun = visibleCount === 1 ? 'command' : 'commands';
      searchStatus.textContent = query === '' ? '' : `${visibleCount} ${noun} shown`;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== commandSearch && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      commandSearch.focus();
    }
  });
}

// Hotkey: press 'R' to run the terminal sample when the hero is in view.
document.addEventListener('keydown', (e) => {
  const isTyping = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.isContentEditable;
  const heroInView = document.querySelector('.hero')?.getBoundingClientRect().top < window.innerHeight;

  if (e.key.toLowerCase() === 'r' && !isTyping && !e.ctrlKey && !e.metaKey && !e.altKey && heroInView) {
    if (demoRun && !demoRun.disabled) {
      e.preventDefault();
      demoRun.click();
    }
  }
});
