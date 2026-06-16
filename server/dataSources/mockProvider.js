/**
 * Mock provider.
 *
 * This is the always-available fallback. It returns a realistic FIFA World Cup
 * 2026 group-stage structure (48 teams, groups A-L) so the app is fully usable
 * with zero API keys. Data here is ILLUSTRATIVE and clearly labelled as mock.
 *
 * The tournament window is 11 June - 19 July 2026. To keep the "upcoming"
 * browser populated regardless of the real calendar date, kickoff times are
 * generated relative to the current day at load time.
 */

import { buildMatch } from '../utils/normalize.js';

export const meta = {
  id: 'mock',
  name: 'Mock Data (no API key)',
  live: false,
};

// A representative slice of the 48-team field with FIFA-style 3-letter codes.
// Each team carries lightweight stats so buildMatchContext has something real
// to summarise even in offline mode.
const TEAMS = {
  USA: { name: 'United States', code: 'USA', group: 'A', fifaRank: 16 },
  MEX: { name: 'Mexico', code: 'MEX', group: 'A', fifaRank: 14 },
  CAN: { name: 'Canada', code: 'CAN', group: 'B', fifaRank: 31 },
  CRO: { name: 'Croatia', code: 'CRO', group: 'B', fifaRank: 10 },
  ARG: { name: 'Argentina', code: 'ARG', group: 'C', fifaRank: 1 },
  NGA: { name: 'Nigeria', code: 'NGA', group: 'C', fifaRank: 41 },
  FRA: { name: 'France', code: 'FRA', group: 'D', fifaRank: 2 },
  SEN: { name: 'Senegal', code: 'SEN', group: 'D', fifaRank: 19 },
  ESP: { name: 'Spain', code: 'ESP', group: 'E', fifaRank: 8 },
  JPN: { name: 'Japan', code: 'JPN', group: 'E', fifaRank: 18 },
  ENG: { name: 'England', code: 'ENG', group: 'F', fifaRank: 4 },
  ECU: { name: 'Ecuador', code: 'ECU', group: 'F', fifaRank: 23 },
  BRA: { name: 'Brazil', code: 'BRA', group: 'G', fifaRank: 5 },
  KOR: { name: 'South Korea', code: 'KOR', group: 'G', fifaRank: 22 },
  POR: { name: 'Portugal', code: 'POR', group: 'H', fifaRank: 6 },
  MAR: { name: 'Morocco', code: 'MAR', group: 'H', fifaRank: 12 },
  GER: { name: 'Germany', code: 'GER', group: 'I', fifaRank: 9 },
  AUS: { name: 'Australia', code: 'AUS', group: 'I', fifaRank: 24 },
  NED: { name: 'Netherlands', code: 'NED', group: 'J', fifaRank: 7 },
  GHA: { name: 'Ghana', code: 'GHA', group: 'J', fifaRank: 68 },
  BEL: { name: 'Belgium', code: 'BEL', group: 'K', fifaRank: 3 },
  COL: { name: 'Colombia', code: 'COL', group: 'K', fifaRank: 15 },
  ITA: { name: 'Italy', code: 'ITA', group: 'L', fifaRank: 11 },
  USAW: { name: 'Uruguay', code: 'URU', group: 'L', fifaRank: 13 },
};

// Per-team mock tournament + recent-form snapshot.
const STATS = {
  USA: { tournamentForm: 'W D', goalsFor: 3, goalsAgainst: 1, recentForm: 'W W D L W', restDays: 4 },
  MEX: { tournamentForm: 'W L', goalsFor: 2, goalsAgainst: 2, recentForm: 'W L D W W', restDays: 4 },
  CAN: { tournamentForm: 'L D', goalsFor: 1, goalsAgainst: 3, recentForm: 'L W L D L', restDays: 3 },
  CRO: { tournamentForm: 'W W', goalsFor: 4, goalsAgainst: 1, recentForm: 'W D W W D', restDays: 5 },
  ARG: { tournamentForm: 'W W', goalsFor: 5, goalsAgainst: 1, recentForm: 'W W W D W', restDays: 4 },
  NGA: { tournamentForm: 'D L', goalsFor: 2, goalsAgainst: 3, recentForm: 'D L W L D', restDays: 4 },
  FRA: { tournamentForm: 'W D', goalsFor: 3, goalsAgainst: 1, recentForm: 'W W D W L', restDays: 5 },
  SEN: { tournamentForm: 'W L', goalsFor: 2, goalsAgainst: 2, recentForm: 'W D L W W', restDays: 3 },
  ESP: { tournamentForm: 'W W', goalsFor: 6, goalsAgainst: 2, recentForm: 'W W W W D', restDays: 4 },
  JPN: { tournamentForm: 'W D', goalsFor: 3, goalsAgainst: 2, recentForm: 'W D W L W', restDays: 4 },
  ENG: { tournamentForm: 'W D', goalsFor: 3, goalsAgainst: 1, recentForm: 'W D D W W', restDays: 5 },
  ECU: { tournamentForm: 'D D', goalsFor: 1, goalsAgainst: 1, recentForm: 'D D W L D', restDays: 4 },
  BRA: { tournamentForm: 'W W', goalsFor: 5, goalsAgainst: 0, recentForm: 'W W W W W', restDays: 4 },
  KOR: { tournamentForm: 'L D', goalsFor: 2, goalsAgainst: 4, recentForm: 'L D W L W', restDays: 3 },
  POR: { tournamentForm: 'W W', goalsFor: 4, goalsAgainst: 1, recentForm: 'W W D W W', restDays: 5 },
  MAR: { tournamentForm: 'W D', goalsFor: 3, goalsAgainst: 1, recentForm: 'W W D D W', restDays: 4 },
  GER: { tournamentForm: 'W L', goalsFor: 3, goalsAgainst: 3, recentForm: 'W L W D W', restDays: 4 },
  AUS: { tournamentForm: 'L L', goalsFor: 1, goalsAgainst: 4, recentForm: 'L L D W L', restDays: 3 },
  NED: { tournamentForm: 'W D', goalsFor: 4, goalsAgainst: 2, recentForm: 'W D W W D', restDays: 5 },
  GHA: { tournamentForm: 'L D', goalsFor: 2, goalsAgainst: 4, recentForm: 'L D L W L', restDays: 3 },
  BEL: { tournamentForm: 'W D', goalsFor: 3, goalsAgainst: 2, recentForm: 'W D W L W', restDays: 4 },
  COL: { tournamentForm: 'W W', goalsFor: 4, goalsAgainst: 1, recentForm: 'W W D W W', restDays: 5 },
  ITA: { tournamentForm: 'D W', goalsFor: 3, goalsAgainst: 2, recentForm: 'D W W D W', restDays: 4 },
  USAW: { tournamentForm: 'W D', goalsFor: 3, goalsAgainst: 1, recentForm: 'W D W W L', restDays: 4 },
};

const VENUES = [
  { venue: 'MetLife Stadium', city: 'East Rutherford' },
  { venue: 'SoFi Stadium', city: 'Los Angeles' },
  { venue: 'AT&T Stadium', city: 'Dallas' },
  { venue: 'Mercedes-Benz Stadium', city: 'Atlanta' },
  { venue: 'Estadio Azteca', city: 'Mexico City' },
  { venue: 'BMO Field', city: 'Toronto' },
  { venue: 'Lumen Field', city: 'Seattle' },
  { venue: 'Hard Rock Stadium', city: 'Miami' },
  { venue: 'Arrowhead Stadium', city: 'Kansas City' },
  { venue: 'Levi\'s Stadium', city: 'San Francisco Bay Area' },
];

// Fixture pairings (home, away). Spread across the days around "today".
const FIXTURES = [
  ['BRA', 'KOR', -1, 'complete', 3, 0],
  ['ARG', 'NGA', -1, 'complete', 2, 1],
  ['ESP', 'JPN', 0, 'live', 1, 0],
  ['ENG', 'ECU', 0, 'live', 0, 0],
  ['FRA', 'SEN', 0, 'scheduled', null, null],
  ['POR', 'MAR', 1, 'scheduled', null, null],
  ['NED', 'GHA', 1, 'scheduled', null, null],
  ['GER', 'AUS', 1, 'scheduled', null, null],
  ['USA', 'MEX', 2, 'scheduled', null, null],
  ['CRO', 'CAN', 2, 'scheduled', null, null],
  ['BEL', 'COL', 2, 'scheduled', null, null],
  ['ITA', 'USAW', 3, 'scheduled', null, null],
  ['BRA', 'NGA', 4, 'scheduled', null, null],
  ['ARG', 'KOR', 4, 'scheduled', null, null],
  ['ESP', 'ENG', 5, 'scheduled', null, null],
  ['FRA', 'POR', 5, 'scheduled', null, null],
];

/**
 * Build the mock fixture list relative to the current day.
 * @returns {object[]} canonical matches
 */
function buildFixtures() {
  const base = new Date();
  base.setUTCHours(18, 0, 0, 0); // 18:00 UTC default kickoff slot

  return FIXTURES.map((f, i) => {
    const [home, away, dayOffset, status, hs, as] = f;
    const h = TEAMS[home];
    const a = TEAMS[away];
    const kickoff = new Date(base);
    kickoff.setUTCDate(base.getUTCDate() + dayOffset);
    // stagger kickoffs across the day so a day has several distinct times
    kickoff.setUTCHours(15 + (i % 4) * 3, 0, 0, 0);
    const v = VENUES[i % VENUES.length];

    return buildMatch({
      id: `mock-${i + 1}`,
      provider: 'mock',
      homeTeam: h.name,
      awayTeam: a.name,
      homeCode: h.code,
      awayCode: a.code,
      group: `Group ${h.group}`,
      kickoffUtc: kickoff.toISOString(),
      venue: v.venue,
      city: v.city,
      status,
      homeScore: hs,
      awayScore: as,
    });
  });
}

/**
 * @returns {Promise<{matches: object[], meta: object}>}
 */
export async function getUpcomingMatches() {
  return { matches: buildFixtures(), meta: { ...meta, isMock: true } };
}

/**
 * Extra per-team context the mock knows about, used by buildMatchContext.
 * @param {string} teamCode FIFA 3-letter code
 */
export function getTeamStats(teamCode) {
  const key = Object.keys(TEAMS).find((k) => TEAMS[k].code === teamCode);
  if (!key) return null;
  return { ...TEAMS[key], ...STATS[key] };
}

export default { meta, getUpcomingMatches, getTeamStats };
