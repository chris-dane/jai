/**
 * Global Documentation Q&A System - Overhauled
 * Provides conversational interface across all documentation
 */

// --- constants
const SCORE_THRESHOLD = 0.05;   // minimum section score
const MMR_K = 4;                // max sentences to select
const MMR_LAMBDA = 0.72;        // MMR relevance vs diversity balance
const AVG_LENGTH = 120;         // average section length for BM25

// --- readiness state
let corpus = null;
let corpusReady = false;

// --- sample queries
const SAMPLE_QUERIES = [
  "What security features are available?",
  "How do I secure webhooks and handle signature verification and retries?",
  "How do I set up authentication and apply API rate limits?"
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

// ---------- text utils ----------
const STOP = new Set("a an and or the is are was were be been being of to in for on with by at from as it this that which".split(" "));
const splitSentences = (t) => (t||"").replace(/\s+/g," ").match(/[^.!?]+[.!?]/g) || [];
const tokens = (t) => (t||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(x=>x && !STOP.has(x));
const uniq = (arr) => [...new Set(arr)];

// ---------- lightweight IDF ----------
function buildIdfIndex(corpus) {
  const df = new Map();
  let N = 0;
  corpus.forEach(doc => {
    doc.sections.forEach(s => {
      N++;
      uniq(tokens([s.heading, s.body].join(" "))).forEach(tok=>{
        df.set(tok, (df.get(tok)||0)+1);
      });
    });
  });
  const idf = new Map();
  df.forEach((n, tok)=> idf.set(tok, Math.log(1 + (N - n + 0.5)/(n + 0.5))));
  return {idf, N};
}

// ---------- section scorer (BM25-lite) ----------
function scoreSection(queryToks, sec, idf) {
  const text = [sec.heading, sec.body].join(" ");
  const toks = tokens(text);
  const freq = new Map();
  toks.forEach(t=>freq.set(t,(freq.get(t)||0)+1));
  const len = toks.length || 1;
  const avgLen = AVG_LENGTH;
  const k1 = 1.2, b = 0.75;
  let s = 0;
  queryToks.forEach(q=>{
    const f = freq.get(q)||0;
    const w = (idf.get(q)||0);
    s += w * (f*(k1+1)) / (f + k1*(1 - b + b*(len/avgLen)));
  });
  // boosts
  const htoks = new Set(tokens(sec.heading));
  queryToks.forEach(q=> { if (htoks.has(q)) s += 0.2; });
  return s;
}

// ---------- sentence extraction + MMR ----------
function extractCandidates(query, sec) {
  const qs = tokens(query);
  return splitSentences(sec.body).map(s=>{
    const overlap = new Set(tokens(s).filter(t=>qs.includes(t))).size;
    return {sent:s.trim(), score:overlap};
  }).filter(x=>x.score>0);
}

function mmrSelect(cands, k=3, lambda=0.7) {
  const selected = [];
  while (selected.length<k && cands.length) {
    let bestIdx = -1, bestScore = -1;
    for (let i=0;i<cands.length;i++){
      const simToSel = selected.length ? Math.max(...selected.map(sel=>jaccard(cands[i].sent, sel.sent))) : 0;
      const mmr = lambda*cands[i].score - (1-lambda)*simToSel;
      if (mmr>bestScore){ bestScore=mmr; bestIdx=i; }
    }
    selected.push(cands.splice(bestIdx,1)[0]);
  }
  return selected;
}

function jaccard(a,b){
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  const I = [...A].filter(x=>B.has(x)).length;
  const U = new Set([...A,...B]).size || 1;
  return I/U;
}

// ---------- main answer generator ----------
function generateAnswer(query, docs) {
  const {idf} = buildIdfIndex(docs);
  const qToks = uniq(tokens(query));
  // rank sections
  const scored = [];
  docs.forEach(doc=>{
    doc.sections.forEach(sec=>{
      const s = scoreSection(qToks, sec, idf);
      if (s>SCORE_THRESHOLD) scored.push({doc, sec, score:s});
    });
  });
  scored.sort((a,b)=>b.score-a.score);
  const top = scored.slice(0,6);

  // extract grounded sentences
  let allCands = [];
  top.forEach(({doc,sec,score})=>{
    const c = extractCandidates(query, sec).map(x=>({ ...x, doc, sec, secScore:score }));
    allCands = allCands.concat(c);
  });
  if (!allCands.length) return null;

  // select sentences with MMR across sections
  const picked = mmrSelect(allCands.sort((a,b)=>b.score-a.score), MMR_K, MMR_LAMBDA);

  // compose with minimal glue; keep sentences verbatim
  const lead = picked.map(p=>p.sent).join(" ");
  // group sources (≤2 docs, ≤3 sections)
  const srcMap = new Map();
  for (const p of picked) {
    const key = p.doc.id + "::" + p.sec.id;
    if (!srcMap.has(key)) srcMap.set(key, {doc:p.doc, sec:p.sec});
    if (srcMap.size>=3) break;
  }
  const sources = [...srcMap.values()];

  return {
    text: lead,                     // grounded: pure extracted sentences
    sources                          // [{doc, sec}]
  };
}

// --- grounded answer generation
function generateGroundedAnswer(query) {
  if (!corpus || !corpus.docs) return null;
  return generateAnswer(query, corpus.docs);
}

// --- render pipeline
function renderAnswerOrFallback(query) {
  const panel = document.getElementById('answer-panel');
  const hints = document.getElementById('ask-hints');
  if (hints) hints.style.display = 'none';

  const result = generateGroundedAnswer(query);
  
  if (!result) {
    panel.innerHTML = `
      <div class="answer-card">
        <h3>No results found</h3>
        <p>I couldn't find any relevant information. Try rephrasing your question or browse the documentation using the sidebar.</p>
        <button class="btn copy-answer">Copy Answer</button>
      </div>`;
    panel.classList.add('show');        // make visible
    panel.focus();
    return;
  }

  // Render grounded answer with sources
  const sourcesHtml = result.sources.map(({doc, sec}) => `
    <div class="source-chip">
      <span class="source-label">${doc.title} › ${sec.heading}</span>
      <div class="source-buttons">
        <button class="btn open-doc" data-doc="${doc.id}">Open document</button>
        <button class="btn jump-sec" data-doc="${doc.id}" data-sec="${sec.id}">Jump to: ${sec.heading}</button>
      </div>
    </div>
  `).join('');

  panel.innerHTML = `
    <p>${result.text}</p>
    <div class="sources">Sources:</div>
    <div class="sources-list">${sourcesHtml}</div>
  `;
  
  panel.classList.add('show');        // make visible
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

function renderHints() {
  const list = document.getElementById('hints-list');
  const wrap = document.getElementById('ask-hints');
  if (!list) return;
  
  while (list.firstChild) list.removeChild(list.firstChild);
  
  for (const q of SAMPLE_QUERIES) {
    const s = (q||"").trim(); 
    if (!s) continue;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button'; 
    btn.className = 'hint-btn'; 
    btn.dataset.q = s; 
    btn.textContent = `"${s}"`;
    li.appendChild(btn); 
    list.appendChild(li);
  }
  
  wrap && (wrap.style.display = list.childElementCount ? '' : 'none');
}

// --- init
function initGlobalAsk() {
  const input = document.getElementById('global-ask');
  const button = document.getElementById('ask-button');
  
  function submit() {
    if (!corpusReady) return;
    const q = input.value.trim();
    const panel = document.getElementById('answer-panel');
    
    if (!q) {
      panel.replaceChildren();            // remove all nodes
      panel.classList.remove('show');     // keep hidden
      renderHints();
      return;
    }
    renderAnswerOrFallback(q);
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
  
  // Setup event delegation for hint clicks
  document.getElementById('hints-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hint-btn'); 
    if (!btn) return;
    const input = document.getElementById('global-ask');
    const panel = document.getElementById('answer-panel');
    input.value = btn.dataset.q || '';
    panel.replaceChildren(); 
    panel.classList.remove('show');
    submit();
  });
  
  // Render hints from JavaScript
  renderHints();
  
  loadCorpus('corpus.json');
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initGlobalAsk);