/**
 * Data-source decision module.
 *
 * Rather than hardcoding a single football API, this module scores the
 * available providers against explicit criteria and picks the best one that is
 * actually usable given the keys present in the environment. It then attempts
 * providers in ranked order and falls back gracefully, ending at mock data so
 * the app is ALWAYS functional.
 *
 * Decision criteria (each scored 0-3) and why they matter:
 *   wc2026Fixtures  - does it actually carry World Cup 2026 fixtures?
 *   upcoming        - supports upcoming/scheduled matches (not just results)
 *   liveStatus      - exposes live score / match status
 *   teamStats       - standings / team stats to feed the prediction context
 *   freeTier        - has a usable free tier or trial
 *   docs            - quality / clarity of documentation
 *   legal           - clearly allowed for this use
 *   stability       - production stability
 *   serverCallable  - callable from a backend (CORS irrelevant server-side)
 *   predictionData  - richness of data available for predictions
 *
 * The scores below encode a defensible evaluation as of mid-2026. Adjust freely
 * as provider offerings change.
 */

import apiFootball from './apiFootballProvider.js';
import footballData from './footballDataProvider.js';
import sportmonks from './sportmonksProvider.js';
import theSportsDb from './theSportsDbProvider.js';
import mock from './mockProvider.js';

/** @typedef {{provider:object, requiresKey:boolean, scores:object}} Candidate */

const CRITERIA = [
  'wc2026Fixtures',
  'upcoming',
  'liveStatus',
  'teamStats',
  'freeTier',
  'docs',
  'legal',
  'stability',
  'serverCallable',
  'predictionData',
];

/** Static evaluation table. Each value is 0..3 (higher = better). */
const EVALUATION = {
  'api-football': {
    requiresKey: true,
    scores: {
      wc2026Fixtures: 3, upcoming: 3, liveStatus: 3, teamStats: 3, freeTier: 2,
      docs: 3, legal: 3, stability: 3, serverCallable: 3, predictionData: 3,
    },
  },
  'football-data': {
    requiresKey: true,
    scores: {
      wc2026Fixtures: 2, upcoming: 3, liveStatus: 2, teamStats: 2, freeTier: 3,
      docs: 3, legal: 3, stability: 3, serverCallable: 3, predictionData: 2,
    },
  },
  sportmonks: {
    requiresKey: true,
    scores: {
      wc2026Fixtures: 3, upcoming: 3, liveStatus: 3, teamStats: 3, freeTier: 1,
      docs: 3, legal: 3, stability: 3, serverCallable: 3, predictionData: 3,
    },
  },
  thesportsdb: {
    requiresKey: false,
    scores: {
      wc2026Fixtures: 2, upcoming: 2, liveStatus: 1, teamStats: 1, freeTier: 3,
      docs: 2, legal: 3, stability: 2, serverCallable: 3, predictionData: 1,
    },
  },
  // Mock is illustrative, NOT real data, so it scores low on the criteria that
  // matter for a live prediction. It is also always pinned LAST as the final
  // fallback (see planSources) regardless of score, so real sources win.
  mock: {
    requiresKey: false,
    scores: {
      wc2026Fixtures: 0, upcoming: 1, liveStatus: 0, teamStats: 1, freeTier: 3,
      docs: 1, legal: 3, stability: 1, serverCallable: 3, predictionData: 1,
    },
  },
};

const PROVIDERS = {
  'api-football': apiFootball,
  'football-data': footballData,
  sportmonks,
  thesportsdb: theSportsDb,
  mock,
};

/** Sum of the weighted criteria scores. */
function totalScore(id) {
  const e = EVALUATION[id];
  if (!e) return 0;
  return CRITERIA.reduce((sum, c) => sum + (e.scores[c] || 0), 0);
}

/**
 * Produce a ranked, attemptable plan given current env config.
 * @param {object} env - { provider, apiKey, baseUrl }
 * @returns {{ranked:Candidate[], explanation:object[]}}
 */
export function planSources(env) {
  const { provider, apiKey } = env;

  // Explicit forcing: honour FOOTBALL_API_PROVIDER unless it is "auto".
  if (provider && provider !== 'auto') {
    const chosen = PROVIDERS[provider];
    if (!chosen) {
      throw new Error(`Unknown FOOTBALL_API_PROVIDER "${provider}"`);
    }
    const ranked = [{ id: provider, provider: chosen, ...EVALUATION[provider] }];
    // Always keep mock as the safety net at the end.
    if (provider !== 'mock') {
      ranked.push({ id: 'mock', provider: mock, ...EVALUATION.mock });
    }
    return { ranked, explanation: rankExplanation(ranked) };
  }

  // Auto mode: rank REAL providers by score. Keyed providers are only eligible
  // when a key exists; no-key real providers (thesportsdb) are always eligible.
  // Mock is deliberately excluded here and pinned last below, so a working real
  // source is always preferred over illustrative mock data.
  const eligible = Object.keys(PROVIDERS).filter((id) => {
    if (id === 'mock') return false;
    const e = EVALUATION[id];
    if (!e.requiresKey) return true;
    return Boolean(apiKey);
  });

  const ranked = eligible
    .sort((a, b) => totalScore(b) - totalScore(a))
    .map((id) => ({ id, provider: PROVIDERS[id], ...EVALUATION[id] }));

  // Mock is ALWAYS the final fallback.
  ranked.push({ id: 'mock', provider: mock, ...EVALUATION.mock });

  return { ranked, explanation: rankExplanation(ranked) };
}

function rankExplanation(ranked) {
  return ranked.map((r) => ({
    id: r.id,
    name: r.provider.meta.name,
    totalScore: totalScore(r.id),
    requiresKey: r.requiresKey,
    scores: EVALUATION[r.id]?.scores,
  }));
}

/**
 * Resolve fixtures by trying the ranked providers in order until one works.
 * @param {object} env - { provider, apiKey, baseUrl }
 * @returns {Promise<{matches:object[], meta:object, plan:object, attempts:object[]}>}
 */
export async function resolveMatches(env) {
  const { ranked, explanation } = planSources(env);
  const attempts = [];

  for (const candidate of ranked) {
    try {
      const result = await candidate.provider.getUpcomingMatches({
        apiKey: env.apiKey,
        baseUrl: env.baseUrl,
      });
      if (result.matches && result.matches.length) {
        attempts.push({ id: candidate.id, ok: true, count: result.matches.length });
        return {
          matches: result.matches,
          meta: result.meta,
          activeProvider: candidate.id,
          plan: explanation,
          attempts,
        };
      }
      attempts.push({ id: candidate.id, ok: true, count: 0, note: 'empty result' });
    } catch (err) {
      attempts.push({ id: candidate.id, ok: false, error: err.message });
    }
  }

  // Absolute last resort (should be unreachable since mock never throws).
  const fallback = await mock.getUpcomingMatches();
  return {
    matches: fallback.matches,
    meta: fallback.meta,
    activeProvider: 'mock',
    plan: explanation,
    attempts,
  };
}

/** Expose the provider module for a given id (used for team stats lookups). */
export function getProviderModule(id) {
  return PROVIDERS[id] || mock;
}

export { CRITERIA, EVALUATION };
export default { planSources, resolveMatches, getProviderModule, CRITERIA, EVALUATION };
