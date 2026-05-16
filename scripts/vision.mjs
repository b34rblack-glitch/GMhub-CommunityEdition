// Community Screen — combat-aware vision focus: mirrors the combat tracker's
// active combatant to the Table, with union-vision fallback out of combat.

import { isGM, isTableUser, getTableUserId, isTableOnline } from "./identity.mjs";
import { executeAsUser, setHandler } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Resolve the token id of the currently-active combatant in a Combat
 * document. The "active combatant" is the one the combat tracker is
 * currently pointing at (i.e. whose turn it is) — NOT whichever token
 * the GM happens to have selected.
 *
 * Some hook handlers receive `combat` directly. When called without an
 * argument, this falls back to `game.combats.active` (which can lag
 * mid-update, so prefer the hook argument when one is available).
 *
 * @param {Combat} [combat]
 * @returns {string | null}
 */
function activeCombatantTokenId(combat) {
  const c = combat ?? game.combats?.active;
  if (!c?.started) return null;
  return c.combatant?.tokenId ?? c.combatant?.token?.id ?? null;
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
 * From the GM client: broadcast the active combatant's token id (or null)
 * to the Table. Reads the combat document directly when one is supplied
 * by a hook — this avoids race conditions where `game.combats.active`
 * still reflects the pre-update state.
 *
 * @param {Combat} [combat]
 * @returns {Promise<void>}
 */
async function broadcastFocus(combat) {
  if (!isGM()) return;
  if (!isTableOnline()) return;
  const tableId = getTableUserId();
  if (!tableId) return;

  const tokenId = activeCombatantTokenId(combat);
  try {
    await executeAsUser("setVisionFocus", tableId, { tokenId });
  } catch (err) {
    logger.debug("broadcastFocus failed:", err);
  }
}

/**
 * Force-release on the Table (combat ended or was deleted).
 *
 * @returns {Promise<void>}
 */
async function releaseTable() {
  if (!isTableOnline()) return;
  const tableId = getTableUserId();
  if (!tableId) return;
  try {
    await executeAsUser("setVisionFocus", tableId, { tokenId: null });
  } catch {
    // Already logged downstream.
  }
}

/**
 * Register vision-related hooks on the GM client and the Table handler
 * on every client.
 *
 * @returns {void}
 */
export function init() {
  // Table-side handler registration (idempotent).
  setHandler("setVisionFocus", _setVisionFocus);

  // GM-side hooks only. controlToken is intentionally NOT a trigger —
  // the GM may select an NPC, trap, light, etc. without intending to change
  // what the Table sees. The combat tracker is the authoritative source.
  Hooks.once("ready", () => {
    if (!isGM()) return;

    Hooks.on("combatStart", (combat) => broadcastFocus(combat));
    Hooks.on("combatTurn", (combat) => broadcastFocus(combat));
    Hooks.on("combatRound", (combat) => broadcastFocus(combat));
    Hooks.on("updateCombat", (combat) => broadcastFocus(combat));
    Hooks.on("combatEnd", () => releaseTable());
    Hooks.on("deleteCombat", () => releaseTable());

    // Initial state once everything is up.
    broadcastFocus();
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
