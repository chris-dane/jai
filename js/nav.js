/**
 * Navigation highlighting system
 * Highlights active nav links based on scroll position
 */

// Public API
export function initNavHighlight({ links, headings }) {
  if (!links || !headings) {
    console.warn('Nav highlight: missing required elements');
    return;
  }

  let ticking = false;

  // Update active nav link based on scroll position
  function updateActiveLink() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const offset = 120; // Account for sticky header

    let activeId = '';
    
    // Find the heading that's currently in view
    headings.forEach(heading => {
      const rect = heading.getBoundingClientRect();
      if (rect.top <= offset) {
        activeId = heading.id;
      }
    });

    // Update nav links
    links.forEach(link => {
      const href = link.getAttribute('href');
      const targetId = href ? href.slice(1) : '';
      
      link.classList.toggle('active', targetId === activeId);
    });

    ticking = false;
  }

  // Throttled scroll handler
  function handleScroll() {
    if (!ticking) {
      requestAnimationFrame(updateActiveLink);
      ticking = true;
    }
  }

  // Initial update
  updateActiveLink();

  // Add scroll listener
  window.addEventListener('scroll', handleScroll, { passive: true });

  // Update on resize (in case layout changes)
  window.addEventListener('resize', handleScroll, { passive: true });
}
