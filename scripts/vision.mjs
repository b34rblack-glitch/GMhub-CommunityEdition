// Community Screen — combat-aware vision focus: mirrors GM controlToken / combat hooks to the Table.

import { isGM, isTableUser, getTableUserId, isTableOnline } from "./identity.mjs";
import { executeAsUser, setHandler } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";
import { debounce } from "./lib/helpers.mjs";

/**
 * Whether any combat is currently active (started encounter).
 *
 * @returns {boolean}
 */
function anyCombatActive() {
  return (game.combats ?? []).some((c) => c.active && c.started);
}

/**
 * On the Table client: set vision focus to a particular token, or release
 * all controls (which falls back to union vision via OBSERVER actors).
 *
 * @param {{tokenId: string | null}} payload
 * @returns {void}
 */
function _setVisionFocus({ tokenId } = {}) {
  if (!isTableUser()) return;
  try {
    if (!tokenId) {
      (canvas?.tokens?.controlled ?? []).forEach((t) => t.release());
    } else {
      const tok = canvas?.tokens?.get(tokenId);
      if (!tok) {
        logger.debug(`setVisionFocus: token ${tokenId} not on this canvas.`);
        return;
      }
      tok.control({ releaseOthers: true });
    }
    canvas?.perception?.update?.({
      refreshVision: true,
      refreshLighting: true,
      refreshSounds: true,
    });
  } catch (err) {
    logger.warn("setVisionFocus failed:", err);
  }
}

/**
 * From the GM client: send the current "what should the Table follow?" to
 * the Table. During combat, follow the GM's last-controlled token;
 * otherwise release.
 *
 * @returns {Promise<void>}
 */
async function broadcastFocus() {
  if (!isGM()) return;
  if (!isTableOnline()) return;
  const tableId = getTableUserId();
  if (!tableId) return;

  let tokenId = null;
  if (anyCombatActive()) {
    // Use first controlled token; if none, leave as null (vision fallback).
    const ctrl = canvas?.tokens?.controlled ?? [];
    tokenId = ctrl[0]?.id ?? null;
  }
  try {
    await executeAsUser("setVisionFocus", tableId, { tokenId });
  } catch (err) {
    logger.debug("broadcastFocus failed:", err);
  }
}

const debouncedBroadcast = debounce(() => broadcastFocus(), 50);

/**
 * Register vision-related hooks on the GM client and the Table handler
 * on every client.
 *
 * @returns {void}
 */
export function init() {
  // Table-side handler registration (idempotent).
  setHandler("setVisionFocus", _setVisionFocus);

  // GM-side hooks only.
  Hooks.once("ready", () => {
    if (!isGM()) return;

    Hooks.on("controlToken", () => debouncedBroadcast());
    Hooks.on("combatStart", () => debouncedBroadcast());
    Hooks.on("combatTurn", () => debouncedBroadcast());
    Hooks.on("combatRound", () => debouncedBroadcast());
    Hooks.on("updateCombat", () => debouncedBroadcast());
    Hooks.on("combatEnd", () => {
      // Force-release on the Table when combat ends.
      const tableId = getTableUserId();
      if (tableId && isTableOnline()) {
        executeAsUser("setVisionFocus", tableId, { tokenId: null }).catch(() => {});
      }
    });
    Hooks.on("deleteCombat", () => {
      const tableId = getTableUserId();
      if (tableId && isTableOnline()) {
        executeAsUser("setVisionFocus", tableId, { tokenId: null }).catch(() => {});
      }
    });

    // Initial state once everything is up.
    debouncedBroadcast();
  });

  // Table-side: if the followed token is deleted mid-combat, release.
  Hooks.on("deleteToken", (doc) => {
    if (!isTableUser()) return;
    const controlled = canvas?.tokens?.controlled?.[0];
    if (controlled?.id === doc.id) {
      controlled.release();
      canvas?.perception?.update?.({ refreshVision: true, refreshLighting: true });
    }
  });
}
