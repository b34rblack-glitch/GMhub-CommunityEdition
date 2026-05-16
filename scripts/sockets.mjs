// ============================================================================
// scripts/sockets.mjs
// ----------------------------------------------------------------------------
// socketlib registration and inter-client RPC dispatch.
//
// Why socketlib (not plain game.socket.emit):
//   - Promises + return values across clients.
//   - executeAsUser targets a single user (vs broadcasting to everyone).
//   - Handles request/response framing so we don't roll our own.
//
// Handler names are the source of truth for the inter-client protocol. We
// register ALL names up front; feature modules call setHandler(name, fn)
// during their own init() to replace the stubs.
//
// Names registered:
//   showJournal/Item/Image/Portrait — open content on the Table
//   closeAllPopups                  — close everything on the Table
//   setVisionFocus                  — switch the Table's controlled token
//   setUiHidden/setTableMode/
//     toggleTableMode               — UI + canvas lock toggle
//   followScene/followLevel         — scene + level mirroring
//   refitScene                      — re-run scene fit on the Table
// ============================================================================

import { MODULE_ID } from "./module.mjs";
import { logger } from "./lib/logger.mjs";
import { setUiHidden } from "./ui-hiding.mjs";
import { engageLock, disengageLock } from "./canvas-lock.mjs";
import { fitSceneToTable } from "./scene-fit.mjs";
import { isTableUser } from "./identity.mjs";
import { set as setSetting, get as getSetting } from "./settings.mjs";

/**
 * The socketlib module handle for this module. Populated by `register()`.
 * Tests/diagnostics can read it via `getSocket()`.
 *
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
 * Stub handler factory. If a name is registered but no feature module
 * has wired a real implementation, calling it just logs the invocation
 * so we can see it on the receiver console while iterating.
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
 * call `setHandler(name, fn)` to override a stub. Map (not plain object) so
 * the iteration order is stable.
 *
 * @type {Map<string, Function>}
 */
const handlers = new Map();

/**
 * Replace a stub with a real implementation. Safe to call before or after
 * `register()` — if called after, the new handler is also pushed to
 * socketlib so the change takes immediate effect.
 *
 * @param {string} name - Handler name.
 * @param {Function} fn - Async or sync handler.
 * @returns {void}
 */
export function setHandler(name, fn) {
  handlers.set(name, fn);
  // If socketlib is already up, re-register so the new handler wins.
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
 * Persisted to the `table-mode` client setting so a Table reload comes
 * back in the same state.
 *
 * @param {{mode: "play" | "setup"}} payload
 * @returns {Promise<void>}
 */
async function _setTableMode({ mode } = {}) {
  if (!isTableUser()) return;
  // Default to "play" if the payload is malformed.
  const next = mode === "setup" ? "setup" : "play";
  try {
    await setSetting("table-mode", next);
  } catch (err) {
    logger.warn("Failed to persist table-mode:", err);
  }
  if (next === "play") {
    // Hide chrome and lock the canvas — "play" is the table-show state.
    setUiHidden(true);
    engageLock();
  } else {
    // Reveal chrome and unlock — "setup" is the GM-at-the-table state.
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
  // Read current state, flip it, then go through the regular setter.
  const current = getSetting("table-mode", "play");
  const next = current === "play" ? "setup" : "play";
  return _setTableMode({ mode: next });
}

/**
 * Set UI hidden state directly (without touching the canvas lock).
 *
 * @param {{hidden: boolean}} payload
 * @returns {void}
 */
function _setUiHidden({ hidden } = {}) {
  if (!isTableUser()) return;
  setUiHidden(Boolean(hidden));
}

/**
 * Recompute scene fit on the Table client. Used by the GM control palette's
 * "Refit Scene" button (since followScene is a no-op when the Table is
 * already on the target scene).
 *
 * @returns {Promise<void>}
 */
async function _refitScene() {
  if (!isTableUser()) return;
  try {
    await fitSceneToTable();
  } catch (err) {
    logger.warn("refitScene failed:", err);
  }
}

/**
 * Register the module with socketlib and bind every handler name we expect.
 * Called from `Hooks.once("socketlib.ready")` in `main.mjs`.
 *
 * @returns {void}
 */
export function register() {
  // socketlib is a hard dep — bail loudly if missing.
  if (!globalThis.socketlib) {
    logger.error("socketlib is not available — module requires the socketlib dependency.");
    return;
  }
  // Acquire the module-scoped socket handle from socketlib.
  cs = socketlib.registerModule(MODULE_ID);

  // Real handlers wired in this file. (Feature-module handlers — popups,
  // vision, scene-follow — are pushed via setHandler() during their inits.)
  handlers.set("setTableMode", _setTableMode);
  handlers.set("toggleTableMode", _toggleTableMode);
  handlers.set("setUiHidden", _setUiHidden);
  handlers.set("refitScene", _refitScene);

  // The full set of names the module supports. Anything not yet wired
  // gets a stub so calls don't throw.
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
    "refitScene",
  ];

  // Push each name to socketlib, preferring a real handler if one was set.
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
  // Guard for callers that fire before socketlib.ready completes.
  if (!cs) {
    logger.warn(`Socket not ready when calling "${handler}".`);
    return undefined;
  }
  try {
    return await cs.executeAsUser(handler, userId, ...args);
  } catch (err) {
    // Most common cause: target user disconnected between check and call.
    logger.error(`Socket "${handler}" failed:`, err);
    try {
      ui.notifications?.warn(game.i18n.localize("COMMUNITY_SCREEN.errors.table-offline"));
    } catch {
      // ui not ready yet (init-time race); swallow.
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
