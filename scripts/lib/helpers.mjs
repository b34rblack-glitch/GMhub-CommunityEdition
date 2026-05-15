// Community Screen — small shared utilities used across feature modules.

/**
 * Localize a Community Screen i18n key with shorthand.
 *
 * @param {string} key - Key under the `COMMUNITY_SCREEN.` namespace. Pass the
 *   full key (e.g. `"settings.fit-mode.name"`) or with the prefix.
 * @param {Record<string, string>} [data] - Optional format substitutions.
 * @returns {string} Localized string, or the key if not translated.
 */
export function t(key, data) {
  const full = key.startsWith("COMMUNITY_SCREEN.") ? key : `COMMUNITY_SCREEN.${key}`;
  if (data) return game.i18n.format(full, data);
  return game.i18n.localize(full);
}

/**
 * Debounce a function. Trailing-edge: the last call wins after `wait` ms of idle.
 *
 * @param {Function} fn - Function to debounce.
 * @param {number} wait - Quiet period in milliseconds.
 * @returns {Function} Debounced wrapper. Has a `.cancel()` method.
 */
export function debounce(fn, wait) {
  let timer = null;
  const wrapped = function (...args) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}
