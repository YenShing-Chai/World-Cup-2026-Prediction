/**
 * Tiny in-memory TTL cache.
 *
 * Used to avoid hammering the football data provider. Upcoming fixtures are
 * cached for 15 minutes by the server. The cache is process-local, which is
 * fine for a single-instance proxy; swap for Redis if you scale horizontally.
 */

const store = new Map();

/**
 * Get a cached value if it has not expired.
 * @param {string} key
 * @returns {*} the cached value, or undefined if missing/expired.
 */
export function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Store a value with a time-to-live.
 * @param {string} key
 * @param {*} value
 * @param {number} ttlMs - time to live in milliseconds.
 */
export function set(key, value, ttlMs) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    storedAt: Date.now(),
  });
}

/**
 * Return when a key was stored, or null.
 * @param {string} key
 * @returns {number|null} epoch milliseconds.
 */
export function storedAt(key) {
  const entry = store.get(key);
  return entry ? entry.storedAt : null;
}

/** Remove a single key. */
export function del(key) {
  store.delete(key);
}

/** Clear the entire cache (used by the refresh button path). */
export function clear() {
  store.clear();
}

export default { get, set, storedAt, del, clear };
