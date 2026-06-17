/**
 * World Cup 2026 AI Predictor - backend proxy.
 *
 * Responsibilities:
 *  - Serve the static frontend (public/).
 *  - Fetch + normalize upcoming World Cup 2026 fixtures via the data-source
 *    selector (keeps API keys server-side; never exposed to the browser).
 *  - Cache fixtures for 15 minutes.
 *  - Run the question-first prediction flow (questions -> answers -> prediction).
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

import cache from './utils/cache.js';
import { resolveMatches, planSources } from './dataSources/dataSourceSelector.js';
import { buildMatchContext } from './prediction/buildMatchContext.js';
import { generateQuestions } from './prediction/questionGenerator.js';
import { generatePrediction } from './prediction/predictionGenerator.js';
import { simulate } from './prediction/simulate.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const FIXTURES_TTL_MS = 15 * 60 * 1000; // 15 minutes
const FIXTURES_KEY = 'upcoming-matches';

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/** Read football config from env. */
function footballEnv() {
  return {
    provider: process.env.FOOTBALL_API_PROVIDER || 'auto',
    apiKey: process.env.FOOTBALL_API_KEY || '',
    baseUrl: process.env.FOOTBALL_API_BASE_URL || '',
  };
}

/** Read AI config from env. */
function aiEnv() {
  return {
    provider: process.env.AI_PROVIDER || 'anthropic',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-opus-4-8',
  };
}

/** Load fixtures, using cache unless force=true. */
async function loadFixtures(force = false) {
  if (!force) {
    const cached = cache.get(FIXTURES_KEY);
    if (cached) {
      return { ...cached, source: 'cache', lastUpdated: cache.storedAt(FIXTURES_KEY) };
    }
  }
  const resolved = await resolveMatches(footballEnv());
  cache.set(FIXTURES_KEY, resolved, FIXTURES_TTL_MS);
  return { ...resolved, source: 'live', lastUpdated: cache.storedAt(FIXTURES_KEY) };
}

/* ------------------------------------------------------------------ */
/* Routes                                                             */
/* ------------------------------------------------------------------ */

/** Data-source status (provider, mode, decision plan). */
app.get('/api/status', async (_req, res) => {
  try {
    const { plan } = planSources(footballEnv());
    const cached = cache.get(FIXTURES_KEY);
    const ai = aiEnv();
    res.json({
      footballProvider: footballEnv().provider,
      decisionPlan: plan,
      aiProvider: ai.provider,
      aiModel: ai.model,
      aiUsingLiveModel: Boolean(ai.apiKey),
      dataMode: cached ? (cached.activeProvider === 'mock' ? 'mock' : 'cached/live') : 'not-loaded',
      activeProvider: cached?.activeProvider || null,
      lastUpdated: cache.storedAt(FIXTURES_KEY),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Set CDN/edge cache headers. On stateless hosts (Vercel) this caches a GOOD
 * response at the edge so the upstream football API is hit at most ~once per
 * window across all users — avoiding its rate limit. A mock/fallback response is
 * never cached, so the app retries real data on the very next request.
 */
function setEdgeCache(res, { isMock, seconds = 900 }) {
  if (isMock) res.set('Cache-Control', 'no-store');
  else res.set('Cache-Control', `public, s-maxage=${seconds}, stale-while-revalidate=600`);
}

/** Upcoming fixtures. ?refresh=1 bypasses the cache. */
app.get('/api/matches/upcoming', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await loadFixtures(force);
    const isMock = data.meta?.isMock === true || data.activeProvider === 'mock';
    setEdgeCache(res, { isMock: isMock || force });
    res.json({
      activeProvider: data.activeProvider,
      isMock,
      providerName: data.meta?.name || data.activeProvider,
      source: data.source,
      lastUpdated: data.lastUpdated,
      count: data.matches.length,
      attempts: data.attempts,
      matches: data.matches,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Structured context for one match. */
app.get('/api/matches/:id/context', async (req, res) => {
  try {
    const data = await loadFixtures(false);
    const match = data.matches.find((m) => m.id === req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const context = buildMatchContext(match, data.activeProvider);
    setEdgeCache(res, { isMock: data.activeProvider === 'mock' });
    res.json({ activeProvider: data.activeProvider, context });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Actual final result for a match (used to settle predictions). */
app.get('/api/matches/:id/result', async (req, res) => {
  try {
    const data = await loadFixtures(false);
    const match = data.matches.find((m) => m.id === req.params.id);
    if (!match) return res.json({ found: false });
    const finished = match.status === 'complete' && match.homeScore != null && match.awayScore != null;
    // Final results never change once finished; cache those. Don't cache mock or
    // not-yet-finished results (the score is still pending).
    setEdgeCache(res, { isMock: data.activeProvider === 'mock' || !finished, seconds: 600 });
    res.json({
      found: true,
      status: match.status,
      finished,
      ft: finished ? { home: match.homeScore, away: match.awayScore } : null,
      ht:
        match.htHomeScore != null && match.htAwayScore != null
          ? { home: match.htHomeScore, away: match.htAwayScore }
          : null,
      provider: data.activeProvider,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Step 1 of prediction flow: ask clarifying questions. */
app.post('/api/prediction/questions', async (req, res) => {
  try {
    const { matchId, matchContext } = req.body || {};
    let context = matchContext;
    if (!context && matchId) {
      const data = await loadFixtures(false);
      const match = data.matches.find((m) => m.id === matchId);
      if (!match) return res.status(404).json({ error: 'Match not found' });
      context = buildMatchContext(match, data.activeProvider);
    }
    if (!context) return res.status(400).json({ error: 'matchId or matchContext required' });
    res.json(generateQuestions(context));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Step 2 of prediction flow: generate the prediction from answers. */
app.post('/api/prediction/generate', async (req, res) => {
  try {
    const { matchId, matchContext, answers } = req.body || {};
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object required' });
    }

    const data = await loadFixtures(false);
    let context = matchContext;
    let activeProvider = data.activeProvider;

    if (!context && matchId) {
      const match = data.matches.find((m) => m.id === matchId);
      if (!match) return res.status(404).json({ error: 'Match not found' });
      context = buildMatchContext(match, data.activeProvider);
    }
    if (!context) return res.status(400).json({ error: 'matchId or matchContext required' });

    const { prediction, engine } = await generatePrediction({
      matchContext: context,
      answers,
      activeProvider,
      ai: aiEnv(),
    });

    res.json({ engine, activeProvider, prediction });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Monte Carlo: run 100 Poisson simulations of the match. */
app.post('/api/prediction/simulate', async (req, res) => {
  try {
    const { matchId, matchContext, runs } = req.body || {};
    const data = await loadFixtures(false);
    let context = matchContext;
    if (!context && matchId) {
      const match = data.matches.find((m) => m.id === matchId);
      if (!match) return res.status(404).json({ error: 'Match not found' });
      context = buildMatchContext(match, data.activeProvider);
    }
    if (!context) return res.status(400).json({ error: 'matchId or matchContext required' });

    const sim = await simulate({
      matchContext: context,
      ai: aiEnv(),
      runs: Math.min(Math.max(Number(runs) || 100, 10), 1000),
    });
    res.json({ activeProvider: data.activeProvider, simulation: sim });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** SPA-ish fallback to index.html for unknown non-API GET routes. */
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start a long-lived server ONLY when run directly (local dev, Render, Railway,
// etc). On Vercel the app is imported by api/index.js as a serverless handler,
// so we must NOT call listen() there — we just export the app below.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  app.listen(PORT, () => {
    console.log(`\n  World Cup 2026 AI Predictor running at http://localhost:${PORT}`);
    console.log(`  Football provider: ${footballEnv().provider}  |  AI provider: ${aiEnv().provider}`);
    console.log(`  ${process.env.FOOTBALL_API_KEY ? 'Football API key detected.' : 'No football API key — mock data fallback active.'}`);
    console.log(`  ${process.env.AI_API_KEY ? 'AI API key detected.' : 'No AI key — local heuristic prediction active.'}\n`);
  });
}

export default app;
