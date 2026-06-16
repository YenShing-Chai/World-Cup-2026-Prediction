/**
 * Sportmonks provider.
 * Docs: https://docs.sportmonks.com/football
 *
 * Deep data (lineups, xG, odds) but the useful World Cup data sits behind paid
 * plans. Included so the app can be pointed at Sportmonks if you hold a key.
 * Auth: `api_token` query parameter.
 *
 * We resolve the World Cup season dynamically by name match, then pull its
 * fixtures with team includes.
 */

import { buildMatch } from '../utils/normalize.js';

const DEFAULT_BASE = 'https://api.sportmonks.com/v3/football';

export const meta = {
  id: 'sportmonks',
  name: 'Sportmonks',
  live: true,
};

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Sportmonks error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/**
 * @param {{apiKey:string, baseUrl?:string}} cfg
 */
export async function getUpcomingMatches({ apiKey, baseUrl }) {
  const base = baseUrl || DEFAULT_BASE;

  // 1. Find the World Cup 2026 season.
  const seasons = await getJson(
    `${base}/seasons/search/World%20Cup?api_token=${apiKey}`
  );
  const season = (seasons.data || []).find((s) =>
    String(s.name).includes('2026')
  );
  if (!season) {
    throw new Error('Sportmonks: no World Cup 2026 season found on this plan');
  }

  // 2. Pull fixtures for that season with participants + venue.
  const fixtures = await getJson(
    `${base}/fixtures?filters=fixtureSeasons:${season.id}` +
      `&include=participants;venue;state;scores&api_token=${apiKey}`
  );

  const matches = (fixtures.data || []).map((fx) => {
    const home = (fx.participants || []).find((p) => p.meta?.location === 'home');
    const away = (fx.participants || []).find((p) => p.meta?.location === 'away');
    const homeScore = (fx.scores || []).find(
      (s) => s.description === 'CURRENT' && s.score?.participant === 'home'
    )?.score?.goals;
    const awayScore = (fx.scores || []).find(
      (s) => s.description === 'CURRENT' && s.score?.participant === 'away'
    )?.score?.goals;

    return buildMatch({
      id: `sportmonks-${fx.id}`,
      provider: 'sportmonks',
      homeTeam: home?.name,
      awayTeam: away?.name,
      homeCode: home?.short_code || '',
      awayCode: away?.short_code || '',
      group: fx.group?.name || '',
      kickoffUtc: fx.starting_at ? `${fx.starting_at.replace(' ', 'T')}Z` : null,
      venue: fx.venue?.name || '',
      city: fx.venue?.city_name || '',
      status: fx.state?.state,
      homeScore: homeScore ?? null,
      awayScore: awayScore ?? null,
    });
  });

  return { matches, meta: { ...meta, isMock: false } };
}

export function getTeamStats() {
  return null;
}

export default { meta, getUpcomingMatches, getTeamStats };
