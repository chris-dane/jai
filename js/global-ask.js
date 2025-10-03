/**
 * Global Documentation Q&A System - Overhauled
 * Provides conversational interface across all documentation
 */

// --- constants
const CANDIDATE_FLOOR = 0.05;   // recall
const STRONG_MATCH = 0.20;      // precision
const BOOST_DOC   = 0.05;       // doc title hit
const BOOST_H2    = 0.08;       // section heading hit
const BOOST_FAQ   = 0.06;       // FAQ preference

// --- readiness state
let corpus = null;
let corpusReady = false;

// --- sample queries
const SAMPLE_QUERIES = [
  "Make a payment link single-use and what will customers see after?",
  "Collect billing and shipping addresses and phone number",
  "What security features are available?"
];

async function loadCorpus(url) {
  const state = document.getElementById('load-state');
  const askBtn = document.getElementById('ask-button');
  try {
    state.textContent = 'Loading documentation…';
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    corpus = await r.json();
    if (!corpus || !Array.isArray(corpus.docs)) throw new Error('Invalid corpus');
    corpusReady = true;
    askBtn.disabled = false;
    state.textContent = '';
    renderSidebar(corpus.docs);
  } catch (e) {
    corpusReady = false;
    askBtn.disabled = true;
    state.textContent = 'Docs failed to load. Please refresh.';
  }
}

// --- token utils
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'with', 'is', 'are', 'be', 'can', 'how', 'what', 'do', 'does', 'did', 'i', 'we', 'you']);

function tokeniseClean(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(t => t && !STOP.has(t));
}

function dice(A, B) {
  if (!A.length || !B.length) return 0;
  const SA = new Set(A), SB = new Set(B);
  const inter = [...SA].filter(x => SB.has(x)).length;
  return (2 * inter) / (SA.size + SB.size);
}

function headingScore(query, heading) {
  const q = tokeniseClean(query), h = tokeniseClean(heading);
  if (!q.length || !h.length) return 0;
  const H = new Set(h);
  if (q.every(x => H.has(x))) return 0.95; // strong exact-ish
  return dice(q, h) + 0.15;              // bias to headings
}

function bestSentenceScore(query, body) {
  const q = tokeniseClean(query);
  const sentences = String(body).split(/(?<=[.!?])\s+/).slice(0, 12);
  let best = 0, sent = '';
  for (const s of sentences) {
    const sc = dice(q, tokeniseClean(s));
    if (sc > best) { best = sc; sent = s; }
  }
  return { score: best, sentence: sent };
}

// --- indexing search across docs, sections, faqs
function searchCorpus(query) {
  const q = query.trim();
  if (!q) return [];
  const results = [];

  for (const d of corpus.docs) {
    // doc title as candidate
    const docS = headingScore(q, d.title);
    if (docS >= 0.30) {
      results.push({ type: 'doc', score: docS + BOOST_DOC, doc: d, snippet: d.title });
    }
    // sections
    for (const s of d.sections || []) {
      const h = headingScore(q, s.heading);
      const { score: b, sentence } = bestSentenceScore(q, s.body || '');
      let score = Math.max(h, b);
      if (h > 0) score += BOOST_H2;
      if (score >= CANDIDATE_FLOOR) {
        results.push({
          type: 'section', score,
          doc: d, section: s,
          snippet: h >= b ? s.heading : sentence
        });
      }
    }
    // faqs (optional in corpus)
    for (const f of d.faqs || []) {
      const h = headingScore(q, f.q || '');
      const { score: b, sentence } = bestSentenceScore(q, f.a || '');
      let score = Math.max(h, b) + BOOST_FAQ;
      if (score >= CANDIDATE_FLOOR) {
        results.push({
          type: 'faq', score,
          doc: d, sectionId: f.section_id,
          snippet: sentence || f.q
        });
      }
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

// --- selection: cap to ≤2 docs, ≤3 sections
function selectSources(cands) {
  const picked = [];
  const seenSections = new Set();
  const seenDocs = new Set();
  for (const c of cands) {
    const docId = c.doc.id;
    const secId = c.type === 'section' ? c.section.id : (c.sectionId || null);
    if (secId && seenSections.has(secId)) continue;
    if (seenDocs.size === 2 && !seenDocs.has(docId)) continue;
    picked.push(c);
    if (secId) seenSections.add(secId);
    seenDocs.add(docId);
    if (picked.length >= 3) break;
  }
  return picked;
}

// --- synthesis from extracted sentences only
function composeAnswer(query, sources) {
  // build sentences per source
  const blocks = sources.map(src => {
    if (src.type === 'section') {
      const { sentence } = bestSentenceScore(query, src.section.body || '');
      return { src, sentences: sentence ? [sentence] : [src.snippet] };
    } else if (src.type === 'faq') {
      const { sentence } = bestSentenceScore(query, src.snippet || '');
      return { src, sentences: sentence ? [sentence] : [src.snippet] };
    } else {
      return { src, sentences: [src.snippet] };
    }
  });
  // first paragraph = join first sentences, max ~2
  const lead = blocks.map(b => b.sentences[0]).filter(Boolean).slice(0, 2).join(' ');
  const html = [
    `<p>${lead}</p>`,
    `<div class="sources">Sources:</div>`,
    `<div class="sources-list">` +
      blocks.map(b => {
        const docTitle = b.src.doc.title;
        const secTitle = b.src.type === 'section'
          ? b.src.section.heading
          : (b.src.type === 'faq' ? (b.src.sectionId || 'FAQ') : 'Document');
        const secId = b.src.type === 'section' ? b.src.section.id : (b.src.sectionId || '');
        return `
          <div class="source-chip">
            <span class="source-label">${docTitle} › ${secTitle}</span>
            <div class="source-buttons">
              <button class="btn open-doc" data-doc="${b.src.doc.id}">Open document</button>
              ${secId ? `<button class="btn jump-sec" data-doc="${b.src.doc.id}" data-sec="${secId}">Jump to: ${secTitle}</button>` : ''}
            </div>
          </div>`;
      }).join('') +
    `</div>`
  ].join('\n');
  return html;
}

// --- render pipeline
function renderAnswerOrFallback(query, cands) {
  const panel = document.getElementById('answer-panel');
  const hints = document.getElementById('ask-hints');
  if (hints) hints.style.display = 'none';

  const strong = cands.filter(c => c.score >= STRONG_MATCH);
  const pool = strong.length ? strong : cands;
  if (!pool.length) {
    panel.innerHTML = `
      <div class="answer-card">
        <h3>No results found</h3>
        <p>I couldn't find any relevant information. Try rephrasing your question or browse the documentation using the sidebar.</p>
        <button class="btn copy-answer">Copy Answer</button>
      </div>`;
    panel.focus();
    return;
  }
  const sources = selectSources(pool);
  panel.innerHTML = composeAnswer(query, sources);
  panel.focus();
  wireAnswerButtons();
}

// --- wire up answer buttons
function wireAnswerButtons() {
  // Copy answer button
  const copyBtn = document.querySelector('.copy-answer');
  if (copyBtn) {
    copyBtn.onclick = () => {
      const text = document.getElementById('answer-panel').textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          announce('Answer copied to clipboard');
        });
      }
    };
  }

  // Open document buttons
  document.querySelectorAll('.open-doc').forEach(btn => {
    btn.onclick = () => {
      const docId = btn.getAttribute('data-doc');
      const doc = corpus.docs.find(d => d.id === docId);
      if (doc) loadDocument(doc);
    };
  });

  // Jump to section buttons
  document.querySelectorAll('.jump-sec').forEach(btn => {
    btn.onclick = () => {
      const docId = btn.getAttribute('data-doc');
      const secId = btn.getAttribute('data-sec');
      const doc = corpus.docs.find(d => d.id === docId);
      const section = doc?.sections.find(s => s.id === secId);
      if (doc && section) jumpToSection(doc, section);
    };
  });
}

// --- existing functions (keep your existing implementations)
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
  
  // Hide answer panel and hints
  const answerPanel = document.getElementById('answer-panel');
  const hints = document.getElementById('ask-hints');
  if (answerPanel) answerPanel.innerHTML = '';
  if (hints) hints.style.display = 'block';
  
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
  
  const docContent = document.getElementById('doc-content');
  if (docContent) {
    docContent.innerHTML = contentHtml;
    docContent.scrollTop = 0;
  }
  
  announce(`Loaded document: ${doc.title}`);
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

function renderSidebar(docs) {
  const docList = document.getElementById('doc-list');
  if (!docList) return;
  
  docList.innerHTML = '';
  
  docs.forEach(doc => {
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

function makeHintLi(query) {
  const li = document.createElement('li');
  li.textContent = `"${query}"`;
  li.addEventListener('click', () => {
    const input = document.getElementById('global-ask');
    input.value = query;
    const button = document.getElementById('ask-button');
    if (button && !button.disabled) {
      const q = input.value.trim();
      if (q) {
        const cands = searchCorpus(q);
        renderAnswerOrFallback(q, cands);
      }
    }
  });
  return li;
}

function renderHints() {
  const hintsList = document.getElementById('hints-list');
  if (!hintsList) return;
  
  const filteredQueries = SAMPLE_QUERIES.filter(Boolean);
  hintsList.replaceChildren(...filteredQueries.map(makeHintLi));
}

// --- init
function initGlobalAsk() {
  const input = document.getElementById('global-ask');
  const button = document.getElementById('ask-button');
  
  function submit() {
    if (!corpusReady) return;
    const q = input.value.trim();
    if (!q) {
      const panel = document.getElementById('answer-panel');
      const hints = document.getElementById('ask-hints');
      panel.innerHTML = '';
      if (hints) hints.style.display = '';
      return;
    }
    const cands = searchCorpus(q);
    renderAnswerOrFallback(q, cands);
  }
  
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  button.addEventListener('click', submit);
  
  // Global keyboard shortcut (Cmd/Ctrl+K)
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
    }
  });
  
  // Render hints from JavaScript
  renderHints();
  
  loadCorpus('corpus.json');
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initGlobalAsk);