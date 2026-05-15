// Community Screen — module-prefixed console logging helper.

const PREFIX = "[Community Screen]";

/**
 * Module-prefixed console logger. Use instead of bare `console.log`.
 *
 * @namespace logger
 */
export const logger = {
  /**
   * Log an informational message.
   * @param {...unknown} args - Values to log.
   * @returns {void}
   */
  info(...args) {
    console.log(PREFIX, ...args);
  },

  /**
   * Log a warning.
   * @param {...unknown} args - Values to log.
   * @returns {void}
   */
  warn(...args) {
    console.warn(PREFIX, ...args);
  },

  /**
   * Log an error.
   * @param {...unknown} args - Values to log.
   * @returns {void}
   */
  error(...args) {
    console.error(PREFIX, ...args);
  },

  /**
   * Log a debug message. Suppressed unless CONFIG.debug.modules contains "community-screen".
   * @param {...unknown} args - Values to log.
   * @returns {void}
   */
  debug(...args) {
    if (globalThis.CONFIG?.debug?.modules?.includes?.("community-screen")) {
      console.log(PREFIX, "[debug]", ...args);
    }
  },
};
