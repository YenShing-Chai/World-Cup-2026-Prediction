/**
 * Build a structured prediction context for a match.
 *
 * The AI should NOT free-guess. This module assembles every piece of data we
 * can find for the two teams into one structured object, and explicitly records
 * which fields are missing so the AI (and the UI) can be honest about gaps.
 */

import { getProviderModule } from '../dataSources/dataSourceSelector.js';
import { toLocal } from '../utils/date.js';

/**
 * @param {object} match - canonical match record
 * @param {string} activeProvider - id of the provider that produced it
 * @returns {object} structured context + missingData list
 */
export function buildMatchContext(match, activeProvider) {
  const providerModule = getProviderModule(activeProvider);
  const missingData = [];

  // Team stats are only available offline from the mock provider today; real
  // providers would need extra calls. We attempt and record gaps honestly.
  const homeStats = safeStats(providerModule, match.homeCode);
  const awayStats = safeStats(providerModule, match.awayCode);

  if (!homeStats) missingData.push(`Detailed team stats for ${match.homeTeam}`);
  if (!awayStats) missingData.push(`Detailed team stats for ${match.awayTeam}`);
  if (!match.venue) missingData.push('Venue');
  missingData.push('Live betting odds (no odds provider configured)');
  missingData.push('Injury / suspension news');
  missingData.push('Confirmed starting lineups');
  if (!homeStats || !awayStats) missingData.push('Head-to-head record');

  const restDelta =
    homeStats && awayStats ? homeStats.restDays - awayStats.restDays : null;

  return {
    match: {
      id: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeCode: match.homeCode,
      awayCode: match.awayCode,
      group: match.group,
      kickoffUtc: match.kickoffUtc,
      kickoffLocal: match.kickoffUtc ? toLocal(match.kickoffUtc) : '',
      venue: match.venue || null,
      city: match.city || null,
      status: match.status,
      currentScore:
        match.homeScore != null && match.awayScore != null
          ? `${match.homeScore}-${match.awayScore}`
          : null,
    },
    teams: {
      home: teamBlock(match.homeTeam, homeStats),
      away: teamBlock(match.awayTeam, awayStats),
    },
    contextFactors: {
      restDaysDelta: restDelta,
      restNote:
        restDelta == null
          ? 'Rest-day data unavailable'
          : restDelta === 0
          ? 'Both teams have equal rest'
          : `${restDelta > 0 ? match.homeTeam : match.awayTeam} has ${Math.abs(
              restDelta
            )} more rest day(s)`,
      venueFactor: match.venue
        ? `Match at ${match.venue}${match.city ? `, ${match.city}` : ''}`
        : 'Venue/travel factor unknown',
      tournamentStage: match.group || 'Stage unknown',
      dataProvider: activeProvider,
      isMockData: activeProvider === 'mock',
    },
    missingData: [...new Set(missingData)],
  };
}

function safeStats(providerModule, code) {
  if (!code || typeof providerModule.getTeamStats !== 'function') return null;
  try {
    return providerModule.getTeamStats(code);
  } catch {
    return null;
  }
}

function teamBlock(name, stats) {
  if (!stats) {
    return {
      name,
      fifaRank: null,
      tournamentForm: null,
      recentForm: null,
      goalsFor: null,
      goalsAgainst: null,
      note: 'No structured stats available for this team',
    };
  }
  return {
    name,
    fifaRank: stats.fifaRank ?? null,
    tournamentForm: stats.tournamentForm ?? null,
    recentForm: stats.recentForm ?? null,
    goalsFor: stats.goalsFor ?? null,
    goalsAgainst: stats.goalsAgainst ?? null,
    restDays: stats.restDays ?? null,
  };
}

export default { buildMatchContext };
