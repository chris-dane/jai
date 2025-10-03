/**
 * Ask system for scoped page Q&A
 * Provides conversational interface using local FAQ data and page sections
 */

// Pure utility functions
export function tokenise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean);
}

export function scoreJaccard(query, text) {
  const queryTokens = new Set(tokenise(query));
  const textTokens = new Set(tokenise(text));
  
  if (queryTokens.size === 0 || textTokens.size === 0) return 0;
  
  const intersection = new Set([...queryTokens].filter(x => textTokens.has(x)));
  const union = new Set([...queryTokens, ...textTokens]);
  
  return intersection.size / union.size;
}

export function buildSectionIndex(rootEl) {
  const sections = [];
  const headings = rootEl.querySelectorAll('h2');
  
  headings.forEach(heading => {
    const id = heading.id;
    const title = heading.textContent;
    
    // Collect text content until next h2
    let text = '';
    let current = heading.nextElementSibling;
    
    while (current && current.tagName !== 'H2') {
      if (current.tagName === 'P' || current.tagName === 'UL' || current.tagName === 'OL' || current.tagName === 'BLOCKQUOTE') {
        text += ' ' + current.textContent;
      }
      current = current.nextElementSibling;
    }
    
    sections.push({ id, title, text: text.trim() });
  });
  
  return sections;
}

export function composeAnswer(query, faqs, sections) {
  const threshold = 0.12;
  const results = [];
  
  // Score FAQs
  faqs.forEach(faq => {
    const score = scoreJaccard(query, `${faq.q} ${faq.a}`);
    if (score >= threshold) {
      results.push({ type: 'faq', score, data: faq });
    }
  });
  
  // Score sections
  sections.forEach(section => {
    const score = scoreJaccard(query, `${section.title} ${section.text}`);
    if (score >= threshold) {
      results.push({ type: 'section', score, data: section });
    }
  });
  
  // Sort by score
  results.sort((a, b) => b.score - a.score);
  
  if (results.length === 0) {
    return { hit: false, html: '', sources: [], confidence: 0 };
  }
  
  // Check for multi-section synthesis (limit usage + deactivation message)
  const limitUsage = results.find(r => r.data.id === 'limit-payments');
  const deactivationMessage = results.find(r => r.data.id === 'deactivated-message');
  
  if (limitUsage && deactivationMessage && results.indexOf(limitUsage) < 3 && results.indexOf(deactivationMessage) < 3) {
    // Multi-section synthesis
    const html = `
      <p>You can limit payment links to a single use and customise what customers see when the link is deactivated.</p>
      <ul>
        <li><strong>Dashboard:</strong> Create or edit the link → enable "Limit the number of payments" and set 1. When limiting payments, choose "Change deactivation message" to customise the message.</li>
        <li><strong>API:</strong> Pass <code>restrictions[completed_sessions][limit]=1</code> when creating or updating. Use <code>inactive_message</code> parameter to set a custom deactivation message.</li>
      </ul>
      <p><strong>What customers see:</strong> When the payment limit is reached, customers see either the default deactivated message or your custom message. The link becomes inactive and customers can't purchase.</p>
      <p class="badge">Sources: Limit the number of times a payment link can be paid; Set a custom message for deactivated links</p>
    `;
    
    return {
      hit: true,
      html,
      sources: [
        { id: 'limit-payments', title: 'Limit the number of times a payment link can be paid' },
        { id: 'deactivated-message', title: 'Set a custom message for deactivated links' }
      ],
      confidence: Math.max(limitUsage.score, deactivationMessage.score)
    };
  }
  
  // Single best match
  const best = results[0];
  let html = '';
  let sources = [];
  
  if (best.type === 'faq') {
    const faq = best.data;
    html = `
      <p>${faq.a}</p>
      <p class="badge">Sources: ${sections.find(s => s.id === faq.id)?.title || faq.id}</p>
    `;
    sources = [{ id: faq.id, title: sections.find(s => s.id === faq.id)?.title || faq.id }];
  } else {
    const section = best.data;
    // Extract key information from section text
    const dashboardMatch = section.text.match(/Dashboard[^]*?(?=API|$)/i);
    const apiMatch = section.text.match(/API[^]*?(?=Dashboard|$)/i);
    
    let intro = `You can ${section.title.toLowerCase().replace(/^[a-z]/, c => c.toUpperCase())}.`;
    
    html = `<p>${intro}</p>`;
    
    if (dashboardMatch) {
      html += `<ul><li><strong>Dashboard:</strong> ${dashboardMatch[0].replace(/Dashboard[:\s]*/i, '').trim()}</li>`;
    }
    
    if (apiMatch) {
      const apiText = apiMatch[0].replace(/API[:\s]*/i, '').trim();
      html += dashboardMatch ? '' : '<ul>';
      html += `<li><strong>API:</strong> ${apiText}</li></ul>`;
    }
    
    html += `<p class="badge">Sources: ${section.title}</p>`;
    sources = [{ id: section.id, title: section.title }];
  }
  
  return {
    hit: true,
    html,
    sources,
    confidence: best.score
  };
}

// Public API
export function initAsk({ inputEl, buttonEl, chips, panelEl, dataSource, sectionSelector }) {
  if (!inputEl || !buttonEl || !panelEl) {
    console.warn('Ask system: missing required elements');
    return;
  }

  let faqData = null;
  let sections = [];
  let isLoading = false;

  // Load FAQ data and build section index
  async function loadData() {
    if (isLoading) return;
    isLoading = true;

    try {
      const response = await fetch(dataSource);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      
      if (data && Array.isArray(data.faqs)) {
        faqData = data.faqs;
      } else {
        throw new Error('Invalid FAQ data structure');
      }
      
      // Build section index from page content
      const docEl = document.querySelector('#doc');
      if (docEl) {
        sections = buildSectionIndex(docEl);
      }
    } catch (error) {
      console.warn('Failed to load FAQ data:', error);
      faqData = null;
    } finally {
      isLoading = false;
    }
  }

  // Render answer in panel
  function renderAnswer(result, query) {
    if (result.hit) {
      let actions = '<div class="actions">';
      actions += '<button class="btn" onclick="copyToClipboard(\'' + result.html.replace(/'/g, "\\'").replace(/<[^>]*>/g, '') + '\')">Copy answer</button>';
      
      // Add jump buttons for each source
      result.sources.forEach(source => {
        actions += `<button class="btn" onclick="jumpToSection('${source.id}')">Jump: ${source.title}</button>`;
      });
      
      actions += '</div>';
      
      panelEl.innerHTML = result.html + actions;
    } else {
      // Show section links as fallback
      const headings = document.querySelectorAll(sectionSelector);
      const links = Array.from(headings)
        .slice(0, 5)
        .map(h => `<a class="btn" href="#${h.id}">${h.textContent}</a>`)
        .join('');
      
      panelEl.innerHTML = `
        <p>No direct answer found. Try these sections:</p>
        <div class="actions">${links}</div>
      `;
    }

    panelEl.classList.add('show');
    panelEl.focus();
  }

  // Copy text to clipboard
  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        announce('Answer copied to clipboard');
      }).catch(() => {
        announce('Failed to copy to clipboard');
      });
    } else {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        announce('Answer copied to clipboard');
      } catch (err) {
        announce('Failed to copy to clipboard');
      }
      document.body.removeChild(textArea);
    }
  }

  // Jump to section with highlight
  function jumpToSection(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      
      // Add highlight effect
      element.classList.add('highlight');
      setTimeout(() => {
        element.classList.remove('highlight');
      }, 2000);
      
      announce(`Jumped to section: ${element.textContent}`);
    }
  }

  // Announce to screen readers
  function announce(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    
    document.body.appendChild(announcement);
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }

  // Handle query submission
  async function handleQuery() {
    const query = inputEl.value.trim();
    if (!query) return;

    inputEl.value = '';
    
    // Ensure data is loaded
    if (!faqData || sections.length === 0) {
      await loadData();
    }

    const result = composeAnswer(query, faqData || [], sections);
    renderAnswer(result, query);
  }

  // Event listeners
  buttonEl.addEventListener('click', handleQuery);
  
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuery();
    }
  });

  // Chip click handlers
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const query = chip.getAttribute('data-q');
      if (query) {
        inputEl.value = query;
        handleQuery();
      }
    });
  });

  // Global keyboard shortcut (Cmd/Ctrl+K)
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      inputEl.focus();
    }
  });

  // Make functions globally available for onclick handlers
  window.jumpToSection = jumpToSection;
  window.copyToClipboard = copyToClipboard;

  // Load data on initialization
  loadData();
}
