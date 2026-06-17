/* World Cup 2026 AI Predictor — frontend logic.
 * Talks only to the local backend proxy (no API keys in the browser). */

const HISTORY_KEY = 'wc2026.predictions.v1';
const LAST_KEY = 'wc2026.lastResult.v1';
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

function saveHistory(prediction, style, matchId) {
  const hist = getHistory();
  const p = prediction.prediction;
  hist.unshift({
    id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7),
    when: new Date().toISOString(),
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

/** Auto-settle: fetch results for all unsettled predictions with a matchId. */
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
  let settledCount = 0;
  let notFinished = 0;
  for (const rec of pending) {
    try {
      const r = await api(`/api/matches/${rec.matchId}/result`);
      if (r.found && r.finished && r.ft) {
        rec.actual = { ft: r.ft, ht: r.ht || null };
        rec.grades = gradePrediction(rec, rec.actual);
        rec.settled = true;
        settledCount++;
      } else {
        notFinished++;
      }
    } catch {
      notFinished++;
    }
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  renderHistory();
  btn.disabled = false;
  btn.textContent = '✓ Check results';
  flash(btn, `Settled ${settledCount}${notFinished ? ` · ${notFinished} not finished yet` : ''}`);
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

  const rows = hist
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
          <div class="t-sub">${fmtDateTime(h.when, { year: 'numeric' })} · ${h.style} · ${h.confidence}%${h.manual ? ' · manual' : ''}</div>
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
  $('planToggle').addEventListener('click', () => $('decisionPlan').classList.toggle('hidden'));
  $('clearHistoryBtn').addEventListener('click', () => {
    if (!confirm('Clear all saved predictions and their results?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });
  $('checkResultsBtn').addEventListener('click', settleAll);

  loadStatus();
  loadMatches();
  renderHistory();
  restoreLastResult();
}

document.addEventListener('DOMContentLoaded', init);
