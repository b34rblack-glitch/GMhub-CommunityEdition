// ============================================================================
// scripts/lib/logger.mjs
// ----------------------------------------------------------------------------
// Module-prefixed console logging helper.
//
// Every log line goes through this so the console has a consistent
// `[Community Screen]` prefix — easy to filter and easy to triage in bug
// reports. Use this instead of bare `console.log`/`warn`/`error`.
//
// `debug()` is gated by Foundry's `CONFIG.debug.modules` array — enable
// noisy debug output in a single session via:
//   CONFIG.debug.modules.push("community-screen");
// in the dev tools console.
// ============================================================================

/** @type {string} String prepended to every line this logger emits. */
const PREFIX = "[Community Screen]";

/**
 * Module-prefixed console logger. Use instead of bare `console.log`.
 *
 * @namespace logger
 */
export const logger = {
  /**
   * Log an informational message. Goes to `console.log` so it's visible by
   * default in Foundry's dev tools without bumping log levels.
   *
   * @param {...unknown} args - Values to log.
   * @returns {void}
   */
  info(...args) {
    // Forward to the browser console with our prefix prepended.
    console.log(PREFIX, ...args);
  },

  /**
   * Log a warning. Goes to `console.warn` so it shows up in the dev tools
   * warning filter and is visually distinct.
   *
   * @param {...unknown} args - Values to log.
   * @returns {void}
   */
  warn(...args) {
    console.warn(PREFIX, ...args);
  },

  /**
   * Log an error. Goes to `console.error` for full stack traces and
   * highest-visibility styling in the dev tools.
   *
   * @param {...unknown} args - Values to log.
   * @returns {void}
   */
  error(...args) {
    console.error(PREFIX, ...args);
  },

  /**
   * Log a debug message. Suppressed unless the user has explicitly opted in
   * by pushing our module id onto Foundry's `CONFIG.debug.modules` array.
   * Use this for verbose diagnostics that would be noise in production.
   *
   * @param {...unknown} args - Values to log.
   * @returns {void}
   */
  debug(...args) {
    // Only emit when the user has opted in to debug noise for this module.
    if (globalThis.CONFIG?.debug?.modules?.includes?.("community-screen")) {
      console.log(PREFIX, "[debug]", ...args);
    }
  },
};
