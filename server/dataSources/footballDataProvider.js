/**
 * football-data.org provider.
 * Docs: https://www.football-data.org/documentation/quickstart
 *
 * Free tier (10 requests/min) covers the World Cup competition (code "WC").
 * Good fallback to API-Football. Auth header: `X-Auth-Token`.
 *
 * Note: on the free tier some future-tournament endpoints are restricted, so
 * this provider may legitimately return 403 until fixtures are published; the
 * selector handles that by falling through to the next source.
 */

import { buildMatch } from '../utils/normalize.js';

const DEFAULT_BASE = 'https://api.football-data.org/v4';
const COMPETITION = 'WC';

export const meta = {
  id: 'football-data',
  name: 'football-data.org',
  live: true,
};

/** Turn "GROUP_A" / "LAST_16" / "QUARTER_FINALS" into "Group A" / "Last 16". */
function prettyStage(group, stage) {
  const raw = group || stage || '';
  if (!raw) return '';
  return raw
    .toLowerCase()
    .split('_')
    .map((w) => (w === 'of' ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * @param {{apiKey:string, baseUrl?:string}} cfg
 */
export async function getUpcomingMatches({ apiKey, baseUrl }) {
  const base = baseUrl || DEFAULT_BASE;
  const url = `${base}/competitions/${COMPETITION}/matches?season=2026`;

  const res = await fetch(url, { headers: { 'X-Auth-Token': apiKey } });
  if (!res.ok) {
    throw new Error(`football-data.org error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();

  const matches = (data.matches || []).map((m) =>
    buildMatch({
      id: `footballdata-${m.id}`,
      provider: 'football-data',
      homeTeam: m.homeTeam?.name,
      awayTeam: m.awayTeam?.name,
      homeCode: m.homeTeam?.tla || '',
      awayCode: m.awayTeam?.tla || '',
      group: prettyStage(m.group, m.stage),
      kickoffUtc: m.utcDate,
      venue: m.venue || '',
      city: '',
      status: m.status,
      homeScore: m.score?.fullTime?.home,
      awayScore: m.score?.fullTime?.away,
      htHomeScore: m.score?.halfTime?.home ?? null,
      htAwayScore: m.score?.halfTime?.away ?? null,
    })
  );

  return { matches, meta: { ...meta, isMock: false } };
}

export function getTeamStats() {
  return null;
}

export default { meta, getUpcomingMatches, getTeamStats };
