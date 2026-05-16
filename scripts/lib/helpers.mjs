// ============================================================================
// scripts/lib/helpers.mjs
// ----------------------------------------------------------------------------
// Small shared utility functions used across feature modules.
//
// Three exports:
//   - t(key, data)    — i18n shorthand that auto-prefixes our namespace
//   - sleep(ms)       — Promise-based setTimeout, for settle delays
//   - debounce(fn, w) — trailing-edge debouncer with .cancel()
//
// No Foundry-specific globals needed at import time (the `t` function reads
// `game.i18n` at call time, which is safe as long as it's not called during
// the very-early init phase before Foundry's i18n system is ready).
// ============================================================================

/**
 * Localize a Community Screen i18n key with shorthand. Accepts either a
 * bare key (e.g. `"settings.fit-mode.name"`) or a fully-qualified key
 * (e.g. `"COMMUNITY_SCREEN.settings.fit-mode.name"`).
 *
 * Uses `game.i18n.format` when `data` is supplied (for `{value}`-style
 * interpolation) and `game.i18n.localize` otherwise.
 *
 * @param {string} key - Key under the `COMMUNITY_SCREEN.` namespace.
 * @param {Record<string, string>} [data] - Optional format substitutions.
 * @returns {string} Localized string, or the key itself if not translated.
 */
export function t(key, data) {
  // Auto-prefix unprefixed keys for ergonomics at call sites.
  const full = key.startsWith("COMMUNITY_SCREEN.") ? key : `COMMUNITY_SCREEN.${key}`;
  // Use the formatting variant when substitutions are provided.
  if (data) return game.i18n.format(full, data);
  // Otherwise plain localize lookup.
  return game.i18n.localize(full);
}

/**
 * Sleep for `ms` milliseconds. Promise-based wrapper around `setTimeout`
 * for use with `await`. Used as a settle delay between document writes
 * (e.g. ownership grants) and the immediately-following socket dispatch
 * so the update has time to propagate to the receiving client.
 *
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Resolves once the timeout fires.
 */
export function sleep(ms) {
  // Wrap setTimeout in a Promise so callers can use it with await.
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Debounce a function. Trailing-edge: only the most recent call within a
 * `wait` ms quiet window actually fires. Returns a wrapper function that
 * also has a `.cancel()` method to clear any pending invocation.
 *
 * Used for things like the resize listener on the Table client — we
 * recompute the scene fit on the LAST resize event in a burst, not every
 * event mid-drag.
 *
 * @param {Function} fn - Function to debounce.
 * @param {number} wait - Quiet period in milliseconds.
 * @returns {Function} Debounced wrapper. Has a `.cancel()` method.
 */
export function debounce(fn, wait) {
  // Captured in closure; holds the pending timeout id (or null when idle).
  let timer = null;
  // The wrapper that callers actually invoke.
  const wrapped = function (...args) {
    // If a previous call is still pending, drop it — only the last call wins.
    if (timer !== null) clearTimeout(timer);
    // Schedule the real call for `wait` ms in the future.
    timer = setTimeout(() => {
      // Clear the timer reference before invoking so re-entry is safe.
      timer = null;
      // Preserve `this` binding and forward the captured args.
      fn.apply(this, args);
    }, wait);
  };
  // Expose a manual cancel — useful when the caller is being torn down.
  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}
