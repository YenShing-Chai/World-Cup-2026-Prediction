/**
 * Date helpers shared across providers.
 *
 * The World Cup 2026 runs 11 June - 19 July 2026 across the USA, Canada and
 * Mexico. We treat "upcoming" as anything from (now - 3h) onwards so that
 * matches that just kicked off still appear in the browser.
 */

/** ISO string for "now". */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Format a UTC ISO timestamp into a readable local string.
 * @param {string} iso
 * @param {string} [timeZone] - IANA tz; defaults to the server's local zone.
 * @returns {string}
 */
export function toLocal(iso, timeZone) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

/**
 * Is the given ISO timestamp in the future (or recent enough to still matter)?
 * @param {string} iso
 * @param {number} [graceHours=3]
 * @returns {boolean}
 */
export function isUpcoming(iso, graceHours = 3) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= Date.now() - graceHours * 3600 * 1000;
}

/** YYYY-MM-DD slice of an ISO timestamp (UTC). */
export function dayKey(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export default { nowIso, toLocal, isUpcoming, dayKey };
