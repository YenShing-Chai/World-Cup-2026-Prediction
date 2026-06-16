/* World Cup 2026 AI Predictor — frontend logic.
 * Talks only to the local backend proxy (no API keys in the browser). */

const HISTORY_KEY = 'wc2026.predictions.v1';
const $ = (id) => document.getElementById(id);

const state = {
  matches: [],
  filtered: [],
  selected: null,
  context: null,
  questions: [],
  lastAnswers: null,
  activeProvider: null,
};

/* ------------------------------------------------------------------ */
/* API helpers                                                        */
/* ------------------------------------------------------------------ */
async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ------------------------------------------------------------------ */
/* Status                                                             */
/* ------------------------------------------------------------------ */
async function loadStatus() {
  try {
    const s = await api('/api/status');
    $('statusAi').textContent = s.aiUsingLiveModel
      ? `${s.aiProvider} (${s.aiModel})`
      : 'Local heuristic (no AI key)';
    renderPlan(s.decisionPlan);
  } catch (e) {
    $('statusAi').textContent = '—';
  }
}

function renderPlan(plan) {
  if (!plan || !plan.length) return;
  const rows = plan
    .map(
      (p, i) =>
        `<tr><td class="${i === 0 ? 'win' : ''}">${i === 0 ? '✓ ' : ''}${p.name}</td>
         <td>${p.totalScore}</td>
         <td>${p.requiresKey ? 'API key' : 'no key'}</td></tr>`
    )
    .join('');
  $('decisionPlan').innerHTML = `
    <p>The selector ranks providers by World Cup coverage, free tier, stability, docs and prediction-data richness, then uses the highest-scoring one that is usable with your keys. Mock data is always the safety net.</p>
    <table><thead><tr><th>Provider</th><th>Score</th><th>Access</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ------------------------------------------------------------------ */
/* Matches                                                            */
/* ------------------------------------------------------------------ */
async function loadMatches(refresh = false) {
  $('matchList').innerHTML = '<div class="empty"><span class="spinner"></span> Loading fixtures…</div>';
  try {
    const data = await api(`/api/matches/upcoming${refresh ? '?refresh=1' : ''}`);
    state.matches = data.matches;
    state.activeProvider = data.activeProvider;

    // Status card
    $('statusProvider').textContent = data.providerName || data.activeProvider;
    $('statusMode').innerHTML = data.isMock
      ? '<span class="badge badge-mock">MOCK DATA</span>'
      : `<span class="badge badge-complete">${data.source === 'cache' ? 'CACHED' : 'LIVE'}</span>`;
    $('statusUpdated').textContent = data.lastUpdated
      ? new Date(data.lastUpdated).toLocaleTimeString()
      : '—';

    buildFilterOptions();
    applyFilters();
  } catch (e) {
    $('matchList').innerHTML = `<div class="error-box">Could not load matches: ${e.message}</div>`;
  }
}

function buildFilterOptions() {
  const groups = [...new Set(state.matches.map((m) => m.group).filter(Boolean))].sort();
  const dates = [...new Set(state.matches.map((m) => (m.kickoffUtc || '').slice(0, 10)).filter(Boolean))].sort();
  $('groupFilter').innerHTML =
    '<option value="">All groups</option>' + groups.map((g) => `<option>${g}</option>`).join('');
  $('dateFilter').innerHTML =
    '<option value="">All dates</option>' +
    dates
      .map((d) => `<option value="${d}">${new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</option>`)
      .join('');
}

function applyFilters() {
  const q = $('searchInput').value.trim().toLowerCase();
  const g = $('groupFilter').value;
  const d = $('dateFilter').value;
  const st = $('statusFilter').value;

  state.filtered = state.matches.filter((m) => {
    if (q && !`${m.homeTeam} ${m.awayTeam} ${m.homeCode} ${m.awayCode}`.toLowerCase().includes(q)) return false;
    if (g && m.group !== g) return false;
    if (d && (m.kickoffUtc || '').slice(0, 10) !== d) return false;
    if (st && m.status !== st) return false;
    return true;
  });
  renderMatchList();
}

function renderMatchList() {
  const list = $('matchList');
  if (!state.filtered.length) {
    list.innerHTML = '<div class="empty">No matches match these filters.</div>';
    return;
  }
  list.innerHTML = state.filtered
    .map((m) => {
      const badge =
        m.status === 'live'
          ? '<span class="badge badge-live">LIVE</span>'
          : m.status === 'complete'
          ? '<span class="badge badge-complete">FT</span>'
          : '<span class="badge badge-scheduled">SCHEDULED</span>';
      const score =
        m.homeScore != null && m.awayScore != null
          ? `<div class="score">${m.homeScore}–${m.awayScore}</div>`
          : `<div class="match-meta">${kickoffShort(m.kickoffUtc)}</div>`;
      return `
        <div class="match-row ${state.selected?.id === m.id ? 'active' : ''}" data-id="${m.id}">
          <div>
            <div class="match-teams">${m.homeTeam} <span class="vs">vs</span> ${m.awayTeam}</div>
            <div class="match-meta">${m.group || 'Group —'} · ${m.venue || 'Venue TBD'}</div>
          </div>
          <div class="match-right">${badge}${score}</div>
        </div>`;
    })
    .join('');

  list.querySelectorAll('.match-row').forEach((row) =>
    row.addEventListener('click', () => selectMatch(row.dataset.id))
  );
}

function kickoffShort(iso) {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/* Selection + context                                                */
/* ------------------------------------------------------------------ */
async function selectMatch(id) {
  const match = state.matches.find((m) => m.id === id);
  if (!match) return;
  state.selected = match;
  renderMatchList();

  // reset downstream panels
  $('questionCard').classList.add('hidden');
  $('resultCard').classList.add('hidden');

  const card = $('selectedCard');
  card.classList.remove('hidden');
  $('selectedBody').innerHTML = `
    <div class="selected-grid">
      <div class="team-block"><div class="team-name">${match.homeTeam}</div><div class="team-code">${match.homeCode || 'home'}</div></div>
      <div class="vs">vs</div>
      <div class="team-block"><div class="team-name">${match.awayTeam}</div><div class="team-code">${match.awayCode || 'away'}</div></div>
    </div>
    <div class="selected-meta">
      <span><b>Kickoff:</b> ${match.kickoffLocal || kickoffShort(match.kickoffUtc)}</span>
      <span><b>Group:</b> ${match.group || '—'}</span>
      <span><b>Venue:</b> ${match.venue || 'TBD'}${match.city ? ', ' + match.city : ''}</span>
      <span><b>Status:</b> ${match.status}</span>
    </div>`;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ------------------------------------------------------------------ */
/* Question-first flow                                                */
/* ------------------------------------------------------------------ */
async function askQuestions() {
  if (!state.selected) return;
  const btn = $('askBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Loading…';
  try {
    const ctx = await api(`/api/matches/${state.selected.id}/context`);
    state.context = ctx.context;
    const { questions } = await api('/api/prediction/questions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matchId: state.selected.id, matchContext: ctx.context }),
    });
    state.questions = questions;
    renderQuestions(questions);
    $('questionCard').classList.remove('hidden');
    $('questionCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    alert('Could not load questions: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ask me questions →';
  }
}

function renderQuestions(questions) {
  $('questionForm').innerHTML = questions
    .map((qn) => {
      if (qn.type === 'multiselect') {
        const chips = qn.options
          .map(
            (o) =>
              `<span class="chip ${qn.default?.includes(o) ? 'selected' : ''}" data-q="${qn.id}" data-val="${o}">${o}</span>`
          )
          .join('');
        return field(qn, `<div class="chip-row" data-multi="${qn.id}">${chips}</div>`);
      }
      const opts = qn.options
        .map((o) => `<option value="${o}" ${o === qn.default ? 'selected' : ''}>${o}</option>`)
        .join('');
      return field(qn, `<select data-q="${qn.id}">${opts}</select>`);
    })
    .join('');

  // wire multiselect chips
  $('questionForm')
    .querySelectorAll('.chip')
    .forEach((c) => c.addEventListener('click', () => c.classList.toggle('selected')));
}

function field(qn, control) {
  return `<div class="q-field">
    <label class="q-label">${qn.question}</label>
    ${qn.help ? `<div class="q-help">${qn.help}</div>` : ''}
    ${control}
  </div>`;
}

function collectAnswers() {
  const answers = {};
  $('questionForm')
    .querySelectorAll('select[data-q]')
    .forEach((s) => (answers[s.dataset.q] = s.value));
  $('questionForm')
    .querySelectorAll('[data-multi]')
    .forEach((group) => {
      const id = group.dataset.multi;
      answers[id] = [...group.querySelectorAll('.chip.selected')].map((c) => c.dataset.val);
    });
  return answers;
}

/* ------------------------------------------------------------------ */
/* Generate prediction                                                */
/* ------------------------------------------------------------------ */
async function generate() {
  if (!state.selected || !state.context) return;
  const answers = collectAnswers();
  state.lastAnswers = answers;
  const compare = $('compareToggle').checked;

  const btn = $('generateBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Predicting…';
  $('resultCard').classList.remove('hidden');
  $('resultBody').innerHTML = '<div class="empty"><span class="spinner"></span> The assistant is analysing the match…</div>';

  try {
    if (compare) {
      const [safe, upset] = await Promise.all([
        requestPrediction({ ...answers, predictionStyle: 'safe' }),
        requestPrediction({ ...answers, predictionStyle: 'high-risk' }),
      ]);
      renderCompare(safe, upset);
      saveHistory(safe.prediction, 'safe vs upset');
    } else {
      const data = await requestPrediction(answers);
      renderPrediction(data);
      saveHistory(data.prediction, answers.predictionStyle || 'balanced');
    }
    $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    $('resultBody').innerHTML = `<div class="error-box">Prediction failed: ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get prediction';
  }
}

function requestPrediction(answers) {
  return api('/api/prediction/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matchId: state.selected.id, matchContext: state.context, answers }),
  });
}

/* ------------------------------------------------------------------ */
/* Render prediction                                                  */
/* ------------------------------------------------------------------ */
function predictionHTML(p, engine) {
  const conf = Math.round(p.prediction.confidence);
  const markets = p.bettingStyleInsights;
  return `
    <div class="result-headline">
      <div class="winner-badge">${p.prediction.winner}</div>
      <div class="confidence-wrap">
        <div class="confidence-bar"><div class="confidence-fill" style="width:${conf}%"></div></div>
        <div class="confidence-num">Confidence: ${conf}% · Risk:
          <span class="risk-${p.prediction.riskLevel}">${p.prediction.riskLevel}</span></div>
      </div>
    </div>
    <div class="pill-row">
      <div class="pill"><b>1st Half:</b> ${labelHalf(p.prediction.halfTime?.result)} (${p.prediction.halfTime?.score ?? '—'})</div>
      <div class="pill"><b>Full Time:</b> ${labelResult(p.prediction.resultType)} (${p.prediction.predictedScore})</div>
      <div class="pill"><b>Style:</b> ${p.userPreference.predictionStyle}</div>
    </div>
    ${p.prediction.halfTime?.note ? `<div class="result-section"><h3>Half-time read</h3><p>${p.prediction.halfTime.note}</p></div>` : ''}

    ${htftSection(p)}

    <div class="result-section">
      <h3>Key reasoning</h3>
      <ul>${(p.reasoning || []).map((r) => `<li>${r}</li>`).join('')}</ul>
    </div>

    <div class="result-section">
      <h3>Best alternative scenario</h3>
      <p>${p.prediction.alternativeScenario}</p>
    </div>

    <div class="result-section">
      <h3>Betting-style insights</h3>
      <div class="pill-row">
        <div class="pill"><b>O/U 2.5:</b> ${markets.overUnder25}</div>
        <div class="pill"><b>BTTS:</b> ${markets.bothTeamsToScore}</div>
        <div class="pill"><b>Handicap:</b> ${markets.handicapView}</div>
      </div>
    </div>

    <div class="result-section">
      <h3>Missing data</h3>
      <div class="tag-list">${(p.missingData || []).map((m) => `<span class="tag">${m}</span>`).join('') || '<span class="tag">None reported</span>'}</div>
    </div>

    <div class="result-section">
      <h3>Data sources used</h3>
      <div class="tag-list">${(p.dataSourcesUsed || []).map((m) => `<span class="tag">${m}</span>`).join('')}${engine ? `<span class="tag">engine: ${engine}</span>` : ''}</div>
    </div>

    <div class="disclaimer">⚠️ ${p.disclaimer}</div>`;
}

function renderPrediction(data) {
  $('resultBody').innerHTML = predictionHTML(data.prediction, data.engine);
}

function renderCompare(safe, upset) {
  $('resultBody').innerHTML = `
    <div class="compare-grid">
      <div class="compare-col">
        <h4>🛡️ Safe</h4>
        ${predictionHTML(safe.prediction, safe.engine)}
      </div>
      <div class="compare-col">
        <h4>🎲 High-risk / Upset</h4>
        ${predictionHTML(upset.prediction, upset.engine)}
      </div>
    </div>`;
}

function labelResult(rt) {
  return rt === 'home_win' ? 'Home win' : rt === 'away_win' ? 'Away win' : 'Draw';
}

function labelHalf(r) {
  return r === 'home_lead' ? 'Home lead' : r === 'away_lead' ? 'Away lead' : 'Level';
}

/** Translate an HT/FT code (e.g. "Draw/Home") into readable team wording. */
function htftWords(code, p) {
  if (!code || !code.includes('/')) return code || '—';
  const [ht, ft] = code.split('/');
  const home = p.match.homeTeam;
  const away = p.match.awayTeam;
  const htw = ht === 'Home' ? `${home} ahead` : ht === 'Away' ? `${away} ahead` : 'Level';
  const ftw = ft === 'Home' ? `${home} win` : ft === 'Away' ? `${away} win` : 'Draw';
  return `${htw} → ${ftw}`;
}

/** Dedicated Half-Time/Full-Time double-result section. */
function htftSection(p) {
  const h = p.prediction.htft;
  if (!h || !h.pick) return '';
  const alts = (h.alternatives || [])
    .map((a) => `<span class="tag">${a} · ${htftWords(a, p)}</span>`)
    .join('');
  return `
    <div class="result-section">
      <h3>HT/FT double result</h3>
      <div class="htft-pick">
        <span class="htft-code">${h.pick}</span>
        <span class="htft-words">${htftWords(h.pick, p)}</span>
        <span class="htft-prob">${Math.round(h.probability)}%</span>
      </div>
      ${h.note ? `<p class="q-help">${h.note}</p>` : ''}
      ${alts ? `<div class="tag-list" style="margin-top:6px"><span class="tag tag-label">alternatives</span>${alts}</div>` : ''}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* History (localStorage)                                             */
/* ------------------------------------------------------------------ */
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(prediction, style) {
  const hist = getHistory();
  hist.unshift({
    when: new Date().toISOString(),
    match: `${prediction.match.homeTeam} vs ${prediction.match.awayTeam}`,
    winner: prediction.prediction.winner,
    score: prediction.prediction.predictedScore,
    confidence: Math.round(prediction.prediction.confidence),
    style,
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 25)));
  renderHistory();
}

function renderHistory() {
  const hist = getHistory();
  const list = $('historyList');
  if (!hist.length) {
    list.innerHTML = '<div class="empty">No predictions saved yet.</div>';
    return;
  }
  list.innerHTML = hist
    .map(
      (h) => `<div class="history-row">
        <div>
          <div><b>${h.match}</b> — ${h.winner} (${h.score})</div>
          <div class="h-meta">${new Date(h.when).toLocaleString()} · ${h.style} · ${h.confidence}% conf.</div>
        </div>
      </div>`
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/* Wire up                                                            */
/* ------------------------------------------------------------------ */
function init() {
  $('refreshBtn').addEventListener('click', () => loadMatches(true));
  ['searchInput', 'groupFilter', 'dateFilter', 'statusFilter'].forEach((id) =>
    $(id).addEventListener('input', applyFilters)
  );
  $('askBtn').addEventListener('click', askQuestions);
  $('generateBtn').addEventListener('click', generate);
  $('rerunBtn').addEventListener('click', generate);
  $('planToggle').addEventListener('click', () => $('decisionPlan').classList.toggle('hidden'));
  $('clearHistoryBtn').addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });

  loadStatus();
  loadMatches();
  renderHistory();
}

document.addEventListener('DOMContentLoaded', init);
