/**
 * Global Documentation Q&A System
 * Provides conversational interface across all documentation
 */

// Global state
let corpus = null;
let currentDoc = null;

// DOM elements
const askInput = document.getElementById('global-ask');
const askButton = document.getElementById('ask-button');
const answerPanel = document.getElementById('answer-panel');
const docContent = document.getElementById('doc-content');
const docList = document.getElementById('doc-list');

// Utility functions
function tokenise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 0);
}

function calculateRelevanceScore(query, text) {
  const queryTokens = new Set(tokenise(query));
  const textTokens = new Set(tokenise(text));
  
  if (queryTokens.size === 0 || textTokens.size === 0) return 0;
  
  const intersection = new Set([...queryTokens].filter(token => textTokens.has(token)));
  const union = new Set([...queryTokens, ...textTokens]);
  
  return intersection.size / union.size;
}

function searchCorpus(query) {
  if (!corpus || !query.trim()) return [];
  
  const results = [];
  const queryLower = query.toLowerCase();
  
  corpus.docs.forEach(doc => {
    // Search in document title
    const titleScore = calculateRelevanceScore(query, doc.title);
    if (titleScore > 0.1) {
      results.push({
        type: 'doc',
        doc,
        section: null,
        score: titleScore * 1.5, // Boost title matches
        text: doc.title,
        context: 'Document title'
      });
    }
    
    // Search in sections
    doc.sections.forEach(section => {
      const sectionText = `${section.heading} ${section.body}`;
      const sectionScore = calculateRelevanceScore(query, sectionText);
      
      if (sectionScore > 0.1) {
        results.push({
          type: 'section',
          doc,
          section,
          score: sectionScore,
          text: section.body,
          context: `${doc.title} > ${section.heading}`
        });
      }
    });
  });
  
  // Sort by relevance score
  return results.sort((a, b) => b.score - a.score);
}

function generateAnswer(query, results) {
  if (results.length === 0) {
    return {
      html: `
        <h3>No results found</h3>
        <p>I couldn't find any relevant information for "${query}". Try rephrasing your question or browse the documentation using the sidebar.</p>
      `,
      sources: []
    };
  }
  
  const topResult = results[0];
  const topResults = results.slice(0, 3);
  
  // If we have a strong match (score > 0.3), provide a detailed answer
  if (topResult.score > 0.3) {
    let answerHtml = `<h3>Answer</h3>`;
    
    if (topResult.type === 'section') {
      answerHtml += `<p>${topResult.section.body}</p>`;
    } else {
      // For document matches, show the first section
      const firstSection = topResult.doc.sections[0];
      if (firstSection) {
        answerHtml += `<p>${firstSection.body}</p>`;
      }
    }
    
    // Add related information if available
    if (topResults.length > 1) {
      answerHtml += `<h4>Related Information</h4><ul>`;
      topResults.slice(1).forEach(result => {
        if (result.type === 'section') {
          answerHtml += `<li><strong>${result.section.heading}</strong>: ${result.section.body.substring(0, 150)}...</li>`;
        }
      });
      answerHtml += `</ul>`;
    }
    
    return {
      html: answerHtml,
      sources: topResults.map(result => ({
        doc: result.doc,
        section: result.section,
        context: result.context
      }))
    };
  } else {
    // For weaker matches, suggest relevant documents
    const uniqueDocs = [...new Set(topResults.map(r => r.doc))];
    
    let answerHtml = `
      <h3>Related Documentation</h3>
      <p>Here are the most relevant documents for "${query}":</p>
      <ul>
    `;
    
    uniqueDocs.slice(0, 3).forEach(doc => {
      answerHtml += `<li><strong>${doc.title}</strong> - Click to view this documentation</li>`;
    });
    
    answerHtml += `</ul>`;
    
    return {
      html: answerHtml,
      sources: uniqueDocs.slice(0, 3).map(doc => ({
        doc,
        section: null,
        context: doc.title
      }))
    };
  }
}

function renderAnswer(answer, query) {
  answerPanel.innerHTML = answer.html;
  
  // Add action buttons
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'answer-actions';
  
  // Copy answer button
  const copyButton = document.createElement('button');
  copyButton.className = 'btn btn-primary';
  copyButton.textContent = 'Copy Answer';
  copyButton.onclick = () => copyToClipboard(answerPanel.textContent);
  actionsDiv.appendChild(copyButton);
  
  // Jump to source buttons
  answer.sources.forEach(source => {
    if (source.section) {
      const jumpButton = document.createElement('button');
      jumpButton.className = 'btn';
      jumpButton.textContent = `Jump to: ${source.section.heading}`;
      jumpButton.onclick = () => jumpToSection(source.doc, source.section);
      actionsDiv.appendChild(jumpButton);
    } else {
      const viewButton = document.createElement('button');
      viewButton.className = 'btn';
      viewButton.textContent = `View: ${source.doc.title}`;
      viewButton.onclick = () => loadDocument(source.doc);
      actionsDiv.appendChild(viewButton);
    }
  });
  
  answerPanel.appendChild(actionsDiv);
  answerPanel.style.display = 'block';
  answerPanel.focus();
}

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

function jumpToSection(doc, section) {
  loadDocument(doc);
  
  // Scroll to section after a brief delay to allow content to load
  setTimeout(() => {
    const sectionElement = document.getElementById(section.id);
    if (sectionElement) {
      sectionElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      
      // Add highlight effect
      sectionElement.classList.add('highlight');
      setTimeout(() => {
        sectionElement.classList.remove('highlight');
      }, 2000);
      
      announce(`Jumped to section: ${section.heading}`);
    }
  }, 100);
}

function loadDocument(doc) {
  currentDoc = doc;
  
  // Update active state in sidebar
  document.querySelectorAll('.doc-link').forEach(link => {
    link.classList.remove('active');
  });
  
  const activeLink = document.querySelector(`[data-doc-id="${doc.id}"]`);
  if (activeLink) {
    activeLink.classList.add('active');
  }
  
  // Hide answer panel
  answerPanel.style.display = 'none';
  
  // Render document content
  let contentHtml = `
    <div class="doc-section">
      <h2>${doc.title}</h2>
  `;
  
  doc.sections.forEach(section => {
    contentHtml += `
      <div id="${section.id}">
        <h3>${section.heading}</h3>
        <p>${section.body}</p>
      </div>
    `;
  });
  
  contentHtml += `</div>`;
  
  docContent.innerHTML = contentHtml;
  
  // Scroll to top
  docContent.scrollTop = 0;
  
  announce(`Loaded document: ${doc.title}`);
}

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

function populateSidebar() {
  if (!corpus) return;
  
  docList.innerHTML = '';
  
  corpus.docs.forEach(doc => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'doc-link';
    link.textContent = doc.title;
    link.setAttribute('data-doc-id', doc.id);
    link.onclick = (e) => {
      e.preventDefault();
      loadDocument(doc);
    };
    
    li.appendChild(link);
    docList.appendChild(li);
  });
}

async function loadCorpus() {
  try {
    const response = await fetch('corpus.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    corpus = await response.json();
    populateSidebar();
  } catch (error) {
    console.error('Failed to load corpus:', error);
    announce('Failed to load documentation. Please refresh the page.');
  }
}

function handleSearch() {
  const query = askInput.value.trim();
  if (!query) return;
  
  askInput.value = '';
  
  const results = searchCorpus(query);
  const answer = generateAnswer(query, results);
  renderAnswer(answer, query);
}

// Event listeners
askButton.addEventListener('click', handleSearch);

askInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleSearch();
  }
});

// Global keyboard shortcut (Cmd/Ctrl+K)
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    askInput.focus();
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadCorpus();
});
