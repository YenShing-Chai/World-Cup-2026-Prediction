/* World Cup 2026 AI Predictor — frontend logic.
 * Talks only to the local backend proxy (no API keys in the browser). */

const HISTORY_KEY = 'wc2026.predictions.v1';
const LAST_KEY = 'wc2026.lastResult.v1';
const SLIP_KEY = 'wc2026.slip.v1';
const $ = (id) => document.getElementById(id);

/* Persist the most recent prediction so it survives a browser refresh. */
function saveLastResult(payload) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(payload)); } catch {}
}
function getLastResult() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; }
}
function clearLastResult() {
  localStorage.removeItem(LAST_KEY);
}

// All times shown in Malaysia time (GMT+8).
const DISPLAY_TZ = 'Asia/Kuala_Lumpur';
const fmtDateTime = (iso, opts = {}) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: DISPLAY_TZ,
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZoneName: 'short', ...opts,
  });
// GMT+8 calendar-day key (YYYY-MM-DD) so date filtering matches the displayed day.
const myDateKey = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: DISPLAY_TZ }) : '');

const state = {
  matches: [],
  filtered: [],
  selected: null,
  context: null,
  questions: [],
  lastAnswers: null,
  activeProvider: null,
  dateInit: false, // has the date filter been defaulted to today yet?
  sortBy: 'date',
  sortDir: 'asc',
  slip: { legs: [], stake: 10 }, // parlay / bet slip (cross-match accumulator)
};

const SORT_KEY = 'wc2026.sort.v1';

// How each sort option ranks a history record (higher = "more").
const SORTS = {
  date: (h) => new Date(h.kickoff || h.when).getTime() || 0,
  confidence: (h) => h.confidence || 0,
  verdict: (h) => (h.settled ? (h.grades?.outcome ? 2 : 1) : 0), // correct > wrong > pending
  added: (h) => new Date(h.when).getTime() || 0,
};

/** Today's date key in Malaysia time (GMT+8), YYYY-MM-DD. */
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: DISPLAY_TZ });

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
      ? new Date(data.lastUpdated).toLocaleTimeString('en-GB', { timeZone: DISPLAY_TZ, hour12: false }) + ' MYT'
      : '—';

    buildFilterOptions();
    applyFilters();
  } catch (e) {
    $('matchList').innerHTML = `<div class="error-box">Could not load matches: ${e.message}</div>`;
  }
}

function buildFilterOptions() {
  const groups = [...new Set(state.matches.map((m) => m.group).filter(Boolean))].sort();
  const dates = [...new Set(state.matches.map((m) => myDateKey(m.kickoffUtc)).filter(Boolean))].sort();
  const prevDate = $('dateFilter').value;

  $('groupFilter').innerHTML =
    '<option value="">All groups</option>' + groups.map((g) => `<option>${g}</option>`).join('');
  $('dateFilter').innerHTML =
    '<option value="">All dates</option>' +
    dates
      .map((d) => `<option value="${d}">${new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}</option>`)
      .join('');

  if (!state.dateInit) {
    // On first load, default to today (GMT+8); if no matches today, jump to the
    // next match day so the list isn't empty. User can switch to "All dates".
    const today = todayKey();
    const upcoming = dates.filter((d) => d >= today).sort();
    $('dateFilter').value = dates.includes(today) ? today : upcoming[0] || '';
    state.dateInit = true;
  } else if (prevDate && dates.includes(prevDate)) {
    // preserve the user's current selection across refreshes
    $('dateFilter').value = prevDate;
  }
}

function applyFilters() {
  const q = $('searchInput').value.trim().toLowerCase();
  const g = $('groupFilter').value;
  const d = $('dateFilter').value;
  const st = $('statusFilter').value;

  state.filtered = state.matches.filter((m) => {
    if (q && !`${m.homeTeam} ${m.awayTeam} ${m.homeCode} ${m.awayCode}`.toLowerCase().includes(q)) return false;
    if (g && m.group !== g) return false;
    if (d && myDateKey(m.kickoffUtc) !== d) return false;
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
  return fmtDateTime(iso); // Malaysia time (GMT+8)
}

/* ------------------------------------------------------------------ */
/* Selection + context                                                */
/* ------------------------------------------------------------------ */
function renderSelectedCard(match) {
  const card = $('selectedCard');
  card.classList.remove('hidden');
  $('selectedBody').innerHTML = `
    <div class="selected-grid">
      <div class="team-block"><div class="team-name">${match.homeTeam}</div><div class="team-code">${match.homeCode || 'home'}</div></div>
      <div class="vs">vs</div>
      <div class="team-block"><div class="team-name">${match.awayTeam}</div><div class="team-code">${match.awayCode || 'away'}</div></div>
    </div>
    <div class="selected-meta">
      <span><b>Kickoff:</b> ${kickoffShort(match.kickoffUtc)}</span>
      <span><b>Group:</b> ${match.group || '—'}</span>
      <span><b>Venue:</b> ${match.venue || 'TBD'}${match.city ? ', ' + match.city : ''}</span>
      <span><b>Status:</b> ${match.status}</span>
    </div>`;
}

async function selectMatch(id) {
  const match = state.matches.find((m) => m.id === id);
  if (!match) return;
  state.selected = match;
  state.context = null;
  clearLastResult(); // picking a new match invalidates the persisted result
  renderMatchList();

  // reset downstream panels
  $('questionCard').classList.add('hidden');
  $('resultCard').classList.add('hidden');
  $('simPanel').classList.add('hidden');
  $('simResult').innerHTML = '';

  renderSelectedCard(match);
  $('selectedCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

function renderQuestions(questions, saved) {
  saved = saved || {};
  $('questionForm').innerHTML = questions
    .map((qn) => {
      const savedVal = saved[qn.id];
      if (qn.type === 'multiselect') {
        const chosen = Array.isArray(savedVal) ? savedVal : qn.default || [];
        const chips = qn.options
          .map(
            (o) =>
              `<span class="chip ${chosen.includes(o) ? 'selected' : ''}" data-q="${qn.id}" data-val="${o}">${o}</span>`
          )
          .join('');
        return field(qn, `<div class="chip-row" data-multi="${qn.id}">${chips}</div>`);
      }
      const sel = savedVal != null ? savedVal : qn.default;
      const opts = qn.options
        .map((o) => `<option value="${o}" ${o === sel ? 'selected' : ''}>${o}</option>`)
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
  // Use the live form if it's rendered, else fall back to the saved answers
  // (e.g. re-run right after a refresh restored the result).
  const formHasFields = $('questionForm').querySelector('[data-q],[data-multi]');
  const answers = formHasFields ? collectAnswers() : state.lastAnswers || {};
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
      saveHistory(safe.prediction, 'safe', state.selected.id);
      saveHistory(upset.prediction, 'high-risk', state.selected.id);
      persistResult({ mode: 'compare', safe, upset });
    } else {
      const data = await requestPrediction(answers);
      renderPrediction(data);
      saveHistory(data.prediction, answers.predictionStyle || 'balanced', state.selected.id);
      persistResult({ mode: 'single', single: data });
    }
    showSimPanel();
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

/** Save the current selection + result so a refresh can restore the panels. */
function persistResult(extra) {
  saveLastResult({
    savedAt: new Date().toISOString(),
    matchId: state.selected?.id || null,
    selected: state.selected,
    context: state.context,
    questions: state.questions,
    answers: state.lastAnswers,
    ...extra,
  });
}

/** On page load, re-show the last selection, questions and prediction result. */
function restoreLastResult() {
  const last = getLastResult();
  if (!last || !last.selected) return;
  state.selected = last.selected;
  state.context = last.context || null;
  state.questions = last.questions || [];
  state.lastAnswers = last.answers || null;

  renderSelectedCard(last.selected);
  if (state.questions.length) {
    renderQuestions(state.questions, state.lastAnswers);
    $('questionCard').classList.remove('hidden');
  }
  $('resultCard').classList.remove('hidden');
  if (last.mode === 'compare' && last.safe && last.upset) {
    renderCompare(last.safe, last.upset);
  } else if (last.single) {
    renderPrediction(last.single);
  }
  showSimPanel();
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

    ${slipAddSection(p)}

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

/* ------------------------------------------------------------------ */
/* Monte Carlo simulation                                             */
/* ------------------------------------------------------------------ */
function showSimPanel() {
  // Available whenever we have a match context to simulate.
  if (!state.context) return;
  $('simPanel').classList.remove('hidden');
  $('simResult').innerHTML = '';
}

async function runSimulation() {
  if (!state.selected || !state.context) return;
  const btn = $('simBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Simulating…';
  $('simResult').innerHTML = '';
  try {
    const data = await api('/api/prediction/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matchId: state.selected.id, matchContext: state.context, runs: 100 }),
    });
    renderSimulation(data.simulation);
  } catch (e) {
    $('simResult').innerHTML = `<div class="error-box">Simulation failed: ${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🎲 Run 100 simulations';
  }
}

function renderSimulation(s) {
  const home = state.context.match.homeTeam;
  const away = state.context.match.awayTeam;
  const eg = s.expectedGoals;
  $('simResult').innerHTML = `
    <div class="sim-head">
      <b>${s.runs} simulations</b> · expected goals
      ${home} <b>${eg.home}</b> – <b>${eg.away}</b> ${away}
      <span class="sim-src">${s.source === 'ai' ? 'AI-estimated' : 'heuristic'}</span>
    </div>
    <div class="sim-bar" role="img" aria-label="Win Draw Loss distribution">
      ${s.homeWinPct ? `<div class="sim-seg seg-home" style="width:${s.homeWinPct}%">${s.homeWinPct}%</div>` : ''}
      ${s.drawPct ? `<div class="sim-seg seg-draw" style="width:${s.drawPct}%">${s.drawPct}%</div>` : ''}
      ${s.awayWinPct ? `<div class="sim-seg seg-away" style="width:${s.awayWinPct}%">${s.awayWinPct}%</div>` : ''}
    </div>
    <div class="sim-legend">
      <span><i class="dot dot-home"></i> ${home} win — <b>${s.homeWinPct}%</b> (${s.homeWin})</span>
      <span><i class="dot dot-draw"></i> Draw — <b>${s.drawPct}%</b> (${s.draw})</span>
      <span><i class="dot dot-away"></i> ${away} win — <b>${s.awayWinPct}%</b> (${s.awayWin})</span>
    </div>
    ${s.rationale ? `<p class="q-help">${s.rationale}</p>` : ''}`;
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
/* Parlay / bet slip                                                  */
/* ------------------------------------------------------------------ */
const clampN = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const escapeAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Implied decimal odds for a leg from its win probability (percent). */
function impliedOdds(prob) {
  return 100 / clampN(Number(prob) || 1, 1, 99);
}

/** Rough O/U 2.5 confidence from how decisive the predicted total is. */
function estProbOU(scoreStr) {
  const sc = parseScoreStr(scoreStr);
  const total = sc ? sc[0] + sc[1] : 2;
  return clampN(Math.round(52 + Math.abs(total - 2.5) * 9), 52, 78);
}
/** Rough BTTS confidence — clearer scorelines read a bit more confidently. */
function estProbBTTS(scoreStr) {
  const sc = parseScoreStr(scoreStr);
  if (!sc) return 55;
  return clampN(Math.round(56 + Math.abs(sc[0] - sc[1]) * 3), 52, 74);
}

function loadSlip() {
  try {
    const s = JSON.parse(localStorage.getItem(SLIP_KEY) || 'null');
    if (s && Array.isArray(s.legs)) {
      state.slip.legs = s.legs;
      state.slip.stake = Number(s.stake) >= 0 ? Number(s.stake) : 10;
    }
  } catch {}
}
function saveSlip() {
  try { localStorage.setItem(SLIP_KEY, JSON.stringify(state.slip)); } catch {}
}

/** Build the "Add to parlay slip" block shown inside a prediction. */
function slipAddSection(p) {
  const mid = state.selected?.id;
  if (!mid) return '';
  const pr = p.prediction;
  const home = p.match.homeTeam;
  const away = p.match.awayTeam;

  const specs = [
    {
      mk: 'result', label: 'Match Result',
      pick: pr.resultType,
      plabel: pr.resultType === 'draw' ? 'Draw' : `${pr.winner} to win`,
      prob: Math.round(pr.confidence), est: false,
    },
  ];
  if (pr.htft?.pick) {
    specs.push({
      mk: 'htft', label: 'HT/FT',
      pick: pr.htft.pick, plabel: htftWords(pr.htft.pick, p),
      prob: Math.round(pr.htft.probability || 25), est: false,
    });
  }
  const ou = pr.markets?.overUnder25;
  if (ou && ou !== 'n/a') {
    specs.push({
      mk: 'ou25', label: 'O/U 2.5',
      pick: ou, plabel: ou === 'over' ? 'Over 2.5 goals' : 'Under 2.5 goals',
      prob: estProbOU(pr.predictedScore), est: true,
    });
  }
  const bt = pr.markets?.btts;
  if (bt && bt !== 'n/a') {
    specs.push({
      mk: 'btts', label: 'BTTS',
      pick: bt, plabel: bt === 'yes' ? 'Both teams to score' : 'Not both to score',
      prob: estProbBTTS(pr.predictedScore), est: true,
    });
  }

  const buttons = specs
    .map((s) => {
      const odds = impliedOdds(s.prob).toFixed(2);
      return `<button type="button" class="slip-add-btn"
        data-mid="${escapeAttr(mid)}" data-home="${escapeAttr(home)}" data-away="${escapeAttr(away)}"
        data-mk="${s.mk}" data-pick="${escapeAttr(s.pick)}" data-plabel="${escapeAttr(s.plabel)}"
        data-mlabel="${escapeAttr(s.label)}" data-prob="${s.prob}" data-est="${s.est ? 1 : 0}">
        <span class="sab-txt"><span class="sab-mk">${s.label}</span><span class="sab-pick">${s.plabel}${s.est ? '<i class="est">est</i>' : ''}</span></span>
        <span class="sab-odds">${odds}<small>${s.prob}%</small></span>
        <span class="sab-plus">+</span>
      </button>`;
    })
    .join('');

  return `
    <div class="result-section slip-add-section">
      <h3>Add to parlay slip</h3>
      <div class="slip-add-row">${buttons}</div>
      <p class="q-help">Cross-match parlay — one leg per match. Adding another pick from this match replaces its leg.</p>
    </div>`;
}

/** Click handler (delegated on #resultBody) for the add-to-slip buttons. */
function onResultBodyClick(e) {
  const btn = e.target.closest('.slip-add-btn');
  if (!btn) return;
  const wasEmpty = state.slip.legs.length === 0;
  const replaced = addLeg(btn.dataset);
  btn.classList.add('added');
  setTimeout(() => btn.classList.remove('added'), 900);
  flashSlip(replaced ? 'Replaced this match’s leg' : 'Added to slip ✓');
  if (wasEmpty) $('slipCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Add a leg from a button dataset. One leg per match (replaces existing). */
function addLeg(d) {
  const legs = state.slip.legs;
  const existing = legs.findIndex((l) => l.matchId === d.mid);
  const replaced = existing !== -1;
  if (replaced) legs.splice(existing, 1);
  legs.push({
    legId: 'l' + Date.now() + Math.random().toString(36).slice(2, 6),
    matchId: d.mid,
    match: `${d.home} vs ${d.away}`,
    homeTeam: d.home,
    awayTeam: d.away,
    kickoff: state.matches.find((m) => m.id === d.mid)?.kickoffUtc || state.selected?.kickoffUtc || null,
    marketKey: d.mk,
    marketLabel: d.mlabel,
    pick: d.pick,
    pickLabel: d.plabel,
    prob: Number(d.prob) || 50,
    estimated: d.est === '1' || d.est === 1 || d.est === true,
    settled: false,
    won: null,
    actual: null,
  });
  saveSlip();
  renderSlip();
  return replaced;
}

function removeLeg(legId) {
  state.slip.legs = state.slip.legs.filter((l) => l.legId !== legId);
  saveSlip();
  renderSlip();
}

function clearSlip() {
  if (!state.slip.legs.length) return;
  if (!confirm('Clear the whole parlay slip?')) return;
  state.slip.legs = [];
  saveSlip();
  renderSlip();
}

function flashSlip(msg) {
  const el = $('slipFlash');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(flashSlip._t);
  flashSlip._t = setTimeout(() => (el.textContent = ''), 2000);
}

const combinedMultiplier = (legs) => legs.reduce((acc, l) => acc * impliedOdds(l.prob), 1);
const combinedProbability = (legs) =>
  legs.reduce((acc, l) => acc * (clampN(Number(l.prob) || 1, 1, 99) / 100), 1) * 100;

/** A parlay is LOST the moment any leg loses; WON only when all legs have won. */
function parlayVerdict(legs) {
  if (legs.some((l) => l.settled && l.won === false)) return 'lost';
  if (legs.length && legs.every((l) => l.settled && l.won === true)) return 'won';
  return 'pending';
}

function renderLegRow(leg) {
  const odds = impliedOdds(leg.prob).toFixed(2);
  const cls = leg.settled ? (leg.won ? 'leg-won' : 'leg-lost') : '';
  const status = leg.settled
    ? leg.won
      ? '<span class="mk mk-ok">✓ won</span>'
      : '<span class="mk mk-no">✗ lost</span>'
    : '';
  const actual =
    leg.settled && leg.actual
      ? `<span class="slip-leg-actual">FT ${leg.actual.ft.home}-${leg.actual.ft.away}</span>`
      : '';
  return `<div class="slip-leg ${cls}">
      <div class="slip-leg-main">
        <div class="slip-leg-match">${leg.match}${leg.kickoff ? `<span class="slip-leg-kick">${kickoffShort(leg.kickoff)}</span>` : ''}</div>
        <div class="slip-leg-pick"><span class="slip-mk-tag">${leg.marketLabel}</span><b>${leg.pickLabel}</b>${leg.estimated ? '<i class="est">est</i>' : ''}${actual}</div>
      </div>
      <div class="slip-leg-right">
        <div class="slip-leg-odds">${odds}<small>${leg.prob}%</small></div>
        ${status}
        <button class="slip-leg-x" data-leg="${leg.legId}" type="button" title="Remove leg">✕</button>
      </div>
    </div>`;
}

function renderSlip() {
  const legs = state.slip.legs;
  $('slipCount').textContent = legs.length ? `${legs.length} leg${legs.length > 1 ? 's' : ''}` : 'empty';
  const body = $('slipBody');
  const footer = $('slipFooter');

  if (!legs.length) {
    body.innerHTML =
      '<div class="empty">No legs yet. Generate a prediction above, then tap “Add to slip” on a market.</div>';
    footer.classList.add('hidden');
    return;
  }

  body.innerHTML = legs.map(renderLegRow).join('');
  body.querySelectorAll('.slip-leg-x').forEach((b) =>
    b.addEventListener('click', () => removeLeg(b.dataset.leg))
  );

  const mult = combinedMultiplier(legs);
  const prob = combinedProbability(legs);
  const stake = Number(state.slip.stake) || 0;
  const verdict = parlayVerdict(legs);
  const vBadge =
    verdict === 'won'
      ? '<span class="badge badge-correct">WON</span>'
      : verdict === 'lost'
      ? '<span class="badge badge-wrong">LOST</span>'
      : '<span class="badge badge-pending">PENDING</span>';

  $('slipCombProb').textContent = `${prob < 0.1 ? '<0.1' : prob.toFixed(1)}%`;
  $('slipMult').textContent = `${mult.toFixed(2)}x`;
  $('slipStake').value = stake;
  $('slipReturns').textContent = (stake * mult).toFixed(2);
  $('slipVerdict').innerHTML = vBadge;
  footer.classList.remove('hidden');
}

/** Grade a single leg against an actual result. true / false / null (ungradeable). */
function gradeLeg(leg, actual) {
  const { ft, ht } = actual;
  if (leg.marketKey === 'result') return outcomeOf(ft.home, ft.away) === leg.pick;
  if (leg.marketKey === 'ou25') return (ft.home + ft.away > 2.5 ? 'over' : 'under') === leg.pick;
  if (leg.marketKey === 'btts') return (ft.home > 0 && ft.away > 0 ? 'yes' : 'no') === leg.pick;
  if (leg.marketKey === 'htft') {
    if (!ht) return null; // need half-time score to grade HT/FT
    const aOutcome = outcomeOf(ft.home, ft.away);
    const aHt = ht.home > ht.away ? 'home_lead' : ht.home < ht.away ? 'away_lead' : 'draw';
    return `${sideCode(aHt)}/${sideCode(aOutcome)}` === leg.pick;
  }
  return null;
}

/** Fetch results and settle every unsettled leg (all legs must win). */
async function settleParlay() {
  const btn = $('checkParlayBtn');
  const pending = state.slip.legs.filter((l) => !l.settled && l.matchId);
  if (!pending.length) {
    flash(btn, 'Nothing to settle');
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Checking…';

  // Refresh fixtures for latest scores (don't clobber real data with mock).
  try {
    const fresh = await api('/api/matches/upcoming');
    if (fresh.matches && fresh.matches.length && !fresh.isMock) state.matches = fresh.matches;
  } catch {}

  let settled = 0;
  let notFinished = 0;
  let notFound = 0;
  let cantGrade = 0;

  for (const leg of pending) {
    let actual = actualFromMatch(state.matches.find((x) => x.id === leg.matchId));
    if (!actual) {
      try {
        const r = await api(`/api/matches/${leg.matchId}/result`);
        if (r.found && r.finished && r.ft) actual = { ft: r.ft, ht: r.ht || null };
        else if (r.found) notFinished++;
        else notFound++;
      } catch {
        notFound++;
      }
    }
    if (actual) {
      const won = gradeLeg(leg, actual);
      if (won === null) {
        cantGrade++;
        continue; // e.g. HT/FT with no half-time data yet
      }
      leg.actual = actual;
      leg.won = won;
      leg.settled = true;
      settled++;
    }
  }

  saveSlip();
  renderSlip();
  btn.disabled = false;
  btn.textContent = '✓ Check parlay result';
  const parts = [`Settled ${settled}`];
  if (notFinished) parts.push(`${notFinished} not finished`);
  if (cantGrade) parts.push(`${cantGrade} missing HT data`);
  if (notFound) parts.push(`${notFound} unavailable`);
  flash(btn, parts.join(' · '));
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

function saveHistory(prediction, style, matchId) {
  const hist = getHistory();
  const p = prediction.prediction;
  hist.unshift({
    id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7),
    when: new Date().toISOString(),
    kickoff: state.selected?.kickoffUtc || null, // match date, used to sort the table
    matchId: matchId || null,
    homeTeam: prediction.match.homeTeam,
    awayTeam: prediction.match.awayTeam,
    match: `${prediction.match.homeTeam} vs ${prediction.match.awayTeam}`,
    style,
    confidence: Math.round(p.confidence),
    predicted: {
      winner: p.winner,
      resultType: p.resultType,
      score: p.predictedScore,
      htResult: p.halfTime?.result || null,
      htScore: p.halfTime?.score || null,
      htft: p.htft?.pick || null,
      ou25: p.markets?.overUnder25 || 'n/a',
      btts: p.markets?.btts || 'n/a',
    },
    settled: false,
    manual: false,
    actual: null, // { ft:{home,away}, ht:{home,away}|null }
    grades: null, // { outcome, score, halfTime, htft, ou25, btts } each true/false/null
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 30)));
  renderHistory();
}

/** Parse "2-1" into [2,1] (handles -, :, – separators). */
function parseScoreStr(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+)\s*[-:–]\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const outcomeOf = (h, a) => (h > a ? 'home_win' : h < a ? 'away_win' : 'draw');
const sideCode = (o) => (o === 'home_win' || o === 'home_lead' ? 'Home' : o === 'away_win' || o === 'away_lead' ? 'Away' : 'Draw');

/** Grade every market for a record against an actual result. true/false/null. */
function gradePrediction(rec, actual) {
  const { ft, ht } = actual;
  const pr = rec.predicted;
  const g = { outcome: null, score: null, halfTime: null, htft: null, ou25: null, btts: null };

  const aOutcome = outcomeOf(ft.home, ft.away);
  g.outcome = pr.resultType ? pr.resultType === aOutcome : null;

  const ps = parseScoreStr(pr.score);
  g.score = ps ? ps[0] === ft.home && ps[1] === ft.away : null;

  const total = ft.home + ft.away;
  g.ou25 = pr.ou25 === 'n/a' ? null : pr.ou25 === (total > 2.5 ? 'over' : 'under');
  g.btts = pr.btts === 'n/a' ? null : pr.btts === (ft.home > 0 && ft.away > 0 ? 'yes' : 'no');

  if (ht) {
    const aHt = ht.home > ht.away ? 'home_lead' : ht.home < ht.away ? 'away_lead' : 'draw';
    g.halfTime = pr.htResult ? pr.htResult === aHt : null;
    const actualHtft = `${sideCode(aHt)}/${sideCode(aOutcome)}`;
    g.htft = pr.htft ? pr.htft === actualHtft : null;
  }
  return g;
}

/** Build an actual-result object from a loaded fixture, or null if not final. */
function actualFromMatch(m) {
  if (!m || m.status !== 'complete' || m.homeScore == null || m.awayScore == null) return null;
  return {
    ft: { home: m.homeScore, away: m.awayScore },
    ht: m.htHomeScore != null && m.htAwayScore != null ? { home: m.htHomeScore, away: m.htAwayScore } : null,
  };
}

/** Auto-settle all unsettled predictions. */
async function settleAll() {
  const btn = $('checkResultsBtn');
  const hist = getHistory();
  const pending = hist.filter((h) => !h.settled && h.matchId);
  if (!pending.length) {
    flash(btn, 'Nothing to settle');
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Checking…';

  // Refresh fixtures so we have the latest scores (keep real data if the refresh
  // happens to fall back to mock — don't overwrite a good list with mock).
  try {
    const fresh = await api('/api/matches/upcoming');
    if (fresh.matches && fresh.matches.length && !fresh.isMock) state.matches = fresh.matches;
  } catch {}

  let settledCount = 0;
  let notFinished = 0;
  let notFound = 0;

  for (const rec of pending) {
    let actual = actualFromMatch(state.matches.find((x) => x.id === rec.matchId));

    // Fallback to the per-match endpoint only if the loaded list didn't have it.
    if (!actual) {
      try {
        const r = await api(`/api/matches/${rec.matchId}/result`);
        if (r.found && r.finished && r.ft) actual = { ft: r.ft, ht: r.ht || null };
        else if (r.found) notFinished++;
        else notFound++;
      } catch {
        notFound++;
      }
    }

    if (actual) {
      rec.actual = actual;
      rec.grades = gradePrediction(rec, actual);
      rec.settled = true;
      settledCount++;
    }
  }

  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  renderHistory();
  btn.disabled = false;
  btn.textContent = '✓ Check results';
  const parts = [`Settled ${settledCount}`];
  if (notFinished) parts.push(`${notFinished} not finished`);
  if (notFound) parts.push(`${notFound} unavailable`);
  flash(btn, parts.join(' · '));
}

function flash(btn, msg) {
  const prev = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => (btn.textContent = prev), 2200);
}

function gBadge(label, val) {
  const cls = val === true ? 'mk-ok' : val === false ? 'mk-no' : 'mk-na';
  const mark = val === true ? '✓' : val === false ? '✗' : '–';
  return `<span class="mk ${cls}">${label} ${mark}</span>`;
}

/** Colour an actual cell green/red by its grade (null = neutral). */
function cellClass(grade) {
  return grade === true ? 't-ok' : grade === false ? 't-no' : '';
}

function renderHistory() {
  const hist = getHistory();
  const list = $('historyList');
  renderScoreboard(hist);

  if (!hist.length) {
    list.innerHTML = '<div class="empty">No predictions saved yet.</div>';
    return;
  }

  // Order by the chosen field + direction (default: match date, earliest first).
  const keyFn = SORTS[state.sortBy] || SORTS.date;
  const dir = state.sortDir === 'desc' ? -1 : 1;
  const sorted = hist.slice().sort((a, b) => (keyFn(a) - keyFn(b)) * dir);

  const rows = sorted
    .map((h) => {
      const verdict = !h.settled
        ? '<span class="badge badge-pending">PENDING</span>'
        : h.grades?.outcome
        ? '<span class="badge badge-correct">CORRECT</span>'
        : '<span class="badge badge-wrong">WRONG</span>';

      const predHT = h.predicted.htScore || '—';
      const predFT = h.predicted.score || '—';
      const actHT = h.settled ? (h.actual.ht ? `${h.actual.ht.home}-${h.actual.ht.away}` : 'n/a') : '—';
      const actFT = h.settled ? `${h.actual.ft.home}-${h.actual.ft.away}` : '—';

      const results = h.settled
        ? `${gBadge('Outcome', h.grades.outcome)} ${gBadge('Score', h.grades.score)} ${gBadge('HT', h.grades.halfTime)} ${gBadge('HT/FT', h.grades.htft)} ${gBadge('O/U 2.5', h.grades.ou25)} ${gBadge('BTTS', h.grades.btts)}`
        : '<span class="t-awaiting">Awaiting result — tap “Check results”</span>';

      return `<tr>
        <td class="t-match">
          <div><b>${h.match}</b></div>
          <div class="t-sub">${h.kickoff ? fmtDateTime(h.kickoff) : fmtDateTime(h.when, { year: 'numeric' })} · ${h.style} · ${h.confidence}%</div>
        </td>
        <td class="t-cell">
          <span class="t-pred">${predHT}</span><span class="t-arrow">→</span><span class="t-act ${cellClass(h.grades?.halfTime)}">${actHT}</span>
        </td>
        <td class="t-cell">
          <span class="t-pred">${predFT}</span><span class="t-arrow">→</span><span class="t-act ${cellClass(h.grades?.outcome)}">${actFT}</span>
        </td>
        <td class="t-verdict">${verdict}</td>
        <td class="t-markets">${results}</td>
      </tr>`;
    })
    .join('');

  list.innerHTML = `
    <div class="table-scroll">
      <table class="hist-table">
        <thead>
          <tr>
            <th>Match</th>
            <th>1st Half<span class="th-sub">pred → actual</span></th>
            <th>Full Time<span class="th-sub">pred → actual</span></th>
            <th>Verdict</th>
            <th>Results</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderScoreboard(hist) {
  const board = $('scoreboard');
  const settled = hist.filter((h) => h.settled && h.grades);
  if (!settled.length) {
    board.classList.add('hidden');
    return;
  }
  board.classList.remove('hidden');
  const correct = settled.filter((h) => h.grades.outcome === true).length;
  const acc = Math.round((correct / settled.length) * 100);
  // per-market hit rates
  const markets = [
    ['Outcome', 'outcome'],
    ['Score', 'score'],
    ['HT', 'halfTime'],
    ['HT/FT', 'htft'],
    ['O/U 2.5', 'ou25'],
    ['BTTS', 'btts'],
  ];
  const chips = markets
    .map(([label, key]) => {
      const graded = settled.filter((h) => h.grades[key] !== null && h.grades[key] !== undefined);
      if (!graded.length) return '';
      const hit = graded.filter((h) => h.grades[key] === true).length;
      return `<span class="sb-chip">${label}: <b>${hit}/${graded.length}</b></span>`;
    })
    .join('');
  board.innerHTML = `
    <div class="sb-headline">
      <span class="sb-big">${correct}/${settled.length}</span>
      <span class="sb-label">outcomes correct</span>
      <span class="sb-acc">${acc}%</span>
    </div>
    <div class="sb-chips">${chips}</div>`;
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
  $('simBtn').addEventListener('click', runSimulation);
  $('planToggle').addEventListener('click', () => $('decisionPlan').classList.toggle('hidden'));
  $('clearHistoryBtn').addEventListener('click', () => {
    if (!confirm('Clear all saved predictions and their results?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });
  $('checkResultsBtn').addEventListener('click', settleAll);

  // Parlay / bet slip.
  $('resultBody').addEventListener('click', onResultBodyClick);
  $('clearSlipBtn').addEventListener('click', clearSlip);
  $('checkParlayBtn').addEventListener('click', settleParlay);
  $('slipStake').addEventListener('input', (e) => {
    state.slip.stake = Math.max(0, Number(e.target.value) || 0);
    saveSlip();
    const mult = combinedMultiplier(state.slip.legs);
    $('slipReturns').textContent = (state.slip.stake * mult).toFixed(2);
  });

  // Sort controls (persisted across sessions).
  loadSortPref();
  $('sortBy').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    saveSortPref();
    renderHistory();
  });
  $('sortDir').addEventListener('click', () => {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    updateSortDirBtn();
    saveSortPref();
    renderHistory();
  });

  loadStatus();
  loadMatches();
  renderHistory();
  loadSlip();
  renderSlip();
  restoreLastResult();
}

function updateSortDirBtn() {
  $('sortDir').textContent = state.sortDir === 'asc' ? '↑ Asc' : '↓ Desc';
}

function loadSortPref() {
  try {
    const s = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
    if (s && SORTS[s.sortBy]) {
      state.sortBy = s.sortBy;
      state.sortDir = s.sortDir === 'desc' ? 'desc' : 'asc';
    }
  } catch {}
  $('sortBy').value = state.sortBy;
  updateSortDirBtn();
}

function saveSortPref() {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify({ sortBy: state.sortBy, sortDir: state.sortDir }));
  } catch {}
}

document.addEventListener('DOMContentLoaded', init);
