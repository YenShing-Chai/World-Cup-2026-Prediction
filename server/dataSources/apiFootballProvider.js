/**
 * API-Football / API-Sports provider.
 * Docs: https://www.api-football.com/documentation-v3
 *
 * Why this is the default real source: best coverage of FIFA competitions
 * including the World Cup, exposes fixtures + status + standings + team stats,
 * has a free tier (100 requests/day), clear docs, and is called server-side so
 * CORS is a non-issue. League id 1 = "World Cup", season 2026.
 *
 * Auth: header `x-apisports-key` (direct) OR RapidAPI headers. We use the
 * direct api-sports.io endpoint.
 */

import { buildMatch } from '../utils/normalize.js';

const DEFAULT_BASE = 'https://v3.football.api-sports.io';
const WORLD_CUP_LEAGUE_ID = 1;
const SEASON = 2026;

export const meta = {
  id: 'api-football',
  name: 'API-Football (API-Sports)',
  live: true,
};

function headers(apiKey, baseUrl) {
  // RapidAPI hosts use different headers; detect by hostname.
  if (baseUrl && baseUrl.includes('rapidapi')) {
    return {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': new URL(baseUrl).host,
    };
  }
  return { 'x-apisports-key': apiKey };
}

/**
 * Fetch upcoming World Cup 2026 fixtures.
 * @param {{apiKey:string, baseUrl?:string}} cfg
 */
export async function getUpcomingMatches({ apiKey, baseUrl }) {
  const base = baseUrl || DEFAULT_BASE;
  const url = `${base}/fixtures?league=${WORLD_CUP_LEAGUE_ID}&season=${SEASON}`;

  const res = await fetch(url, { headers: headers(apiKey, base) });
  if (!res.ok) {
    throw new Error(`API-Football error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();

  if (data.errors && Object.keys(data.errors).length) {
    throw new Error(`API-Football reported: ${JSON.stringify(data.errors)}`);
  }

  const matches = (data.response || []).map((row) =>
    buildMatch({
      id: `apifootball-${row.fixture.id}`,
      provider: 'api-football',
      homeTeam: row.teams?.home?.name,
      awayTeam: row.teams?.away?.name,
      homeCode: '',
      awayCode: '',
      group: row.league?.round || '',
      kickoffUtc: row.fixture?.date,
      venue: row.fixture?.venue?.name || '',
      city: row.fixture?.venue?.city || '',
      status: row.fixture?.status?.short,
      homeScore: row.goals?.home,
      awayScore: row.goals?.away,
    })
  );

  return { matches, meta: { ...meta, isMock: false } };
}

/** This provider does not expose simple synchronous team stats offline. */
export function getTeamStats() {
  return null;
}

export default { meta, getUpcomingMatches, getTeamStats };
