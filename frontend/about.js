document.addEventListener('DOMContentLoaded', () => {
  initSmoothScrolling();
  initNavHighlight();
  initRevealAnimations();
});

function initSmoothScrolling() {
  document.querySelectorAll('.about-nav-link').forEach(link => {
    link.addEventListener('click', event => {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return;

      event.preventDefault();
      const target = document.querySelector(href);
      if (!target) return;

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateActiveNav(link);
    });
  });
}

function initNavHighlight() {
  const sections = Array.from(document.querySelectorAll('section[id], article[id], div[id="contact"]'));
  const navLinks = Array.from(document.querySelectorAll('.about-nav-link'));

  if (!sections.length || !navLinks.length) return;

  const observer = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) return;

    const currentId = visible.target.getAttribute('id');
    const activeLink = navLinks.find(link => link.getAttribute('href') === `#${currentId}`);
    if (activeLink) updateActiveNav(activeLink);
  }, {
    rootMargin: '-35% 0px -45% 0px',
    threshold: [0.15, 0.35, 0.6],
  });

  sections.forEach(section => observer.observe(section));
}

function initRevealAnimations() {
  const revealItems = document.querySelectorAll('[data-reveal]');
  if (!revealItems.length) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -10% 0px',
  });

  revealItems.forEach(item => observer.observe(item));
}

function updateActiveNav(link) {
  document.querySelectorAll('.about-nav-link').forEach(navLink => navLink.classList.remove('active'));
  link.classList.add('active');
}
