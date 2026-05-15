// Community Screen — socketlib registration and inter-client RPC dispatch.

import { MODULE_ID } from "./module.mjs";
import { logger } from "./lib/logger.mjs";
import { setUiHidden } from "./ui-hiding.mjs";
import { engageLock, disengageLock } from "./canvas-lock.mjs";
import { isTableUser } from "./identity.mjs";
import { set as setSetting, get as getSetting } from "./settings.mjs";

/**
 * The socketlib module handle for this module. Populated by `register()`.
 * @type {object | null}
 */
let cs = null;

/**
 * @returns {object | null} The socketlib handle, or null until socketlib.ready fires.
 */
export function getSocket() {
  return cs;
}

/**
 * Stub handler factory. Logs the call so we can see RPC plumbing.
 *
 * @param {string} name - Handler name.
 * @returns {Function}
 */
function stub(name) {
  return (...args) => {
    logger.info(`stub: ${name} called`, ...args);
  };
}

/**
 * Internal registry of handler names → implementations. Feature modules can
 * call `setHandler(name, fn)` to override a stub.
 *
 * @type {Map<string, Function>}
 */
const handlers = new Map();

/**
 * Replace a stub with a real implementation. Safe to call before or after
 * `register()`.
 *
 * @param {string} name - Handler name.
 * @param {Function} fn - Async or sync handler.
 * @returns {void}
 */
export function setHandler(name, fn) {
  handlers.set(name, fn);
  if (cs) {
    try {
      cs.register(name, fn);
    } catch (err) {
      logger.error(`Failed to re-register socket handler "${name}"`, err);
    }
  }
}

/**
 * Apply a Table mode locally on the Table client: pair UI hiding with the
 * canvas lock. "play" hides UI and engages the lock; "setup" reveals UI
 * and disengages.
 *
 * @param {{mode: "play" | "setup"}} payload
 * @returns {Promise<void>}
 */
async function _setTableMode({ mode } = {}) {
  if (!isTableUser()) return;
  const next = mode === "setup" ? "setup" : "play";
  try {
    await setSetting("table-mode", next);
  } catch (err) {
    logger.warn("Failed to persist table-mode:", err);
  }
  if (next === "play") {
    setUiHidden(true);
    engageLock();
  } else {
    setUiHidden(false);
    disengageLock();
  }
  logger.info(`Table mode → ${next}`);
}

/**
 * Toggle Table mode play ↔ setup.
 *
 * @returns {Promise<void>}
 */
async function _toggleTableMode() {
  if (!isTableUser()) return;
  const current = getSetting("table-mode", "play");
  const next = current === "play" ? "setup" : "play";
  return _setTableMode({ mode: next });
}

/**
 * Set UI hidden state (without touching the canvas lock).
 *
 * @param {{hidden: boolean}} payload
 * @returns {void}
 */
function _setUiHidden({ hidden } = {}) {
  if (!isTableUser()) return;
  setUiHidden(Boolean(hidden));
}

/**
 * Register the module with socketlib and bind every handler name we expect.
 * Called from `Hooks.once("socketlib.ready")` in `main.mjs`.
 *
 * @returns {void}
 */
export function register() {
  if (!globalThis.socketlib) {
    logger.error("socketlib is not available — module requires the socketlib dependency.");
    return;
  }
  cs = socketlib.registerModule(MODULE_ID);

  // Real handlers wired in this phase.
  handlers.set("setTableMode", _setTableMode);
  handlers.set("toggleTableMode", _toggleTableMode);
  handlers.set("setUiHidden", _setUiHidden);

  const names = [
    "showJournal",
    "showItem",
    "showImage",
    "showPortrait",
    "closeAllPopups",
    "setVisionFocus",
    "setUiHidden",
    "setTableMode",
    "followScene",
    "followLevel",
    "toggleTableMode",
  ];

  for (const name of names) {
    const fn = handlers.get(name) ?? stub(name);
    cs.register(name, fn);
  }

  logger.info(`Registered ${names.length} socket handlers.`);
}

/**
 * Invoke a handler on a specific user's client. Wraps socketlib's
 * `executeAsUser` with try/catch and a localized warning on failure.
 *
 * @param {string} handler - Handler name registered above.
 * @param {string} userId - Target user id.
 * @param {...*} args - Arguments forwarded to the handler.
 * @returns {Promise<*>}
 */
export async function executeAsUser(handler, userId, ...args) {
  if (!cs) {
    logger.warn(`Socket not ready when calling "${handler}".`);
    return undefined;
  }
  try {
    return await cs.executeAsUser(handler, userId, ...args);
  } catch (err) {
    logger.error(`Socket "${handler}" failed:`, err);
    try {
      ui.notifications?.warn(game.i18n.localize("COMMUNITY_SCREEN.errors.table-offline"));
    } catch {
      // ui not ready yet
    }
    throw err;
  }
}

/**
 * Invoke a handler on a GM client (whichever is connected first).
 *
 * @param {string} handler - Handler name.
 * @param {...*} args - Forwarded args.
 * @returns {Promise<*>}
 */
export async function executeAsGM(handler, ...args) {
  if (!cs) return undefined;
  return cs.executeAsGM(handler, ...args);
}
