/**
 * TheSportsDB provider.
 * Docs: https://www.thesportsdb.com/api.php
 *
 * Useful because it has a free shared test key ("3" / "123") and needs no
 * signup, making it the best *real-network* fallback before mock data. Coverage
 * of future tournaments can be patchy and it has no detailed team stats, but it
 * is fine for browsing fixtures.
 *
 * League id 4429 = "FIFA World Cup". We request next events for that league.
 */

import { buildMatch } from '../utils/normalize.js';

const DEFAULT_BASE = 'https://www.thesportsdb.com/api/v1/json';
const WORLD_CUP_LEAGUE_ID = 4429;

export const meta = {
  id: 'thesportsdb',
  name: 'TheSportsDB',
  live: true,
};

/** Fetch one TheSportsDB endpoint, tolerating failures. */
async function fetchEvents(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.events || [];
  } catch {
    return [];
  }
}

function toMatch(e) {
  const kickoff =
    (e.strTimestamp ? `${e.strTimestamp.replace(' ', 'T')}Z`.replace('ZZ', 'Z') : null) ||
    (e.dateEvent && e.strTime ? `${e.dateEvent}T${e.strTime}Z` : null);
  return buildMatch({
    id: `thesportsdb-${e.idEvent}`,
    provider: 'thesportsdb',
    homeTeam: e.strHomeTeam,
    awayTeam: e.strAwayTeam,
    group: e.strGroup ? `Group ${e.strGroup}` : '',
    kickoffUtc: kickoff,
    venue: e.strVenue || '',
    city: '',
    status: e.strStatus || (e.intHomeScore != null ? 'FT' : 'scheduled'),
    homeScore: e.intHomeScore != null ? Number(e.intHomeScore) : null,
    awayScore: e.intAwayScore != null ? Number(e.intAwayScore) : null,
  });
}

/**
 * The free shared key returns only a few events per endpoint, so we merge the
 * "next events" and "full season" endpoints and de-duplicate by event id to
 * surface as many real World Cup 2026 matches as the key allows.
 * @param {{apiKey?:string, baseUrl?:string}} cfg - apiKey defaults to the free key.
 */
export async function getUpcomingMatches({ apiKey, baseUrl }) {
  const key = apiKey || '3';
  const base = baseUrl || DEFAULT_BASE;

  const [next, season] = await Promise.all([
    fetchEvents(`${base}/${key}/eventsnextleague.php?id=${WORLD_CUP_LEAGUE_ID}`),
    fetchEvents(`${base}/${key}/eventsseason.php?id=${WORLD_CUP_LEAGUE_ID}&s=2026`),
  ]);

  const byId = new Map();
  [...season, ...next].forEach((e) => {
    if (e && e.idEvent) byId.set(e.idEvent, e);
  });

  const matches = [...byId.values()].map(toMatch);
  return { matches, meta: { ...meta, isMock: false } };
}

export function getTeamStats() {
  return null;
}

export default { meta, getUpcomingMatches, getTeamStats };
