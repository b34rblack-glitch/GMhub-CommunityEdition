// Community Screen — combat-aware vision focus: mirrors the combat tracker's
// active combatant to the Table, with union-vision fallback out of combat.

import { isGM, isTableUser, getTableUserId, isTableOnline } from "./identity.mjs";
import { executeAsUser, setHandler } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";
import { debounce } from "./lib/helpers.mjs";

/**
 * Resolve the token id of the active combatant in the currently-active combat,
 * if any. The "active combatant" is the one the combat tracker is currently
 * pointing at (i.e. whose turn it is) — NOT whichever token the GM happens to
 * have selected.
 *
 * @returns {string | null}
 */
function activeCombatantTokenId() {
  const combat = game.combats?.active;
  if (!combat?.started) return null;
  return combat.combatant?.tokenId ?? null;
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
 * the Table. During combat, follow the active combatant from the combat
 * tracker (whoever's turn it is). Out of combat, send null so the Table
 * releases and falls back to native union vision via OBSERVER actors.
 *
 * @returns {Promise<void>}
 */
async function broadcastFocus() {
  if (!isGM()) return;
  if (!isTableOnline()) return;
  const tableId = getTableUserId();
  if (!tableId) return;

  const tokenId = activeCombatantTokenId();
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

  // GM-side hooks only. Note: controlToken is intentionally NOT a trigger —
  // the GM may select an NPC, trap, light, etc. without intending to change
  // what the Table sees. The combat tracker is the authoritative source.
  Hooks.once("ready", () => {
    if (!isGM()) return;

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
