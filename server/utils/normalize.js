/**
 * Match normalization.
 *
 * Every provider returns a different shape. We map all of them into one
 * canonical match model so the frontend and prediction engine never need to
 * know which provider produced the data.
 *
 * Canonical model:
 * {
 *   id, provider, homeTeam, awayTeam, homeCode, awayCode, group,
 *   kickoffUtc, kickoffLocal, venue, city, status, homeScore, awayScore
 * }
 */

import { toLocal } from './date.js';

/** Map a variety of provider status strings to our 3-state model. */
export function normalizeStatus(raw) {
  if (!raw) return 'scheduled';
  const s = String(raw).toLowerCase();
  if (['ft', 'aet', 'pen', 'finished', 'complete', 'match_finished'].some((k) => s.includes(k))) {
    return 'complete';
  }
  if (
    ['1h', '2h', 'ht', 'live', 'in_play', 'inplay', 'et', 'p', 'bt', 'paused', 'playing'].some(
      (k) => s.includes(k)
    )
  ) {
    return 'live';
  }
  return 'scheduled';
}

/**
 * Build a canonical match record, filling sensible defaults.
 * @param {object} partial
 * @returns {object} canonical match
 */
export function buildMatch(partial) {
  const kickoffUtc = partial.kickoffUtc || null;
  return {
    id: String(partial.id ?? ''),
    provider: partial.provider || 'unknown',
    homeTeam: partial.homeTeam || 'TBD',
    awayTeam: partial.awayTeam || 'TBD',
    homeCode: partial.homeCode || '',
    awayCode: partial.awayCode || '',
    group: partial.group || '',
    kickoffUtc,
    kickoffLocal: partial.kickoffLocal || (kickoffUtc ? toLocal(kickoffUtc) : ''),
    venue: partial.venue || '',
    city: partial.city || '',
    status: normalizeStatus(partial.status),
    homeScore: partial.homeScore ?? null,
    awayScore: partial.awayScore ?? null,
    // Half-time scores (used to grade HT and HT/FT markets). Null when the
    // provider does not expose them.
    htHomeScore: partial.htHomeScore ?? null,
    htAwayScore: partial.htAwayScore ?? null,
  };
}

/** Sort matches chronologically, TBD/no-date last. */
export function sortByKickoff(matches) {
  return [...matches].sort((a, b) => {
    if (!a.kickoffUtc) return 1;
    if (!b.kickoffUtc) return -1;
    return new Date(a.kickoffUtc) - new Date(b.kickoffUtc);
  });
}

export default { normalizeStatus, buildMatch, sortByKickoff };
