// Community Screen — combat-aware vision focus: mirrors the combat tracker's
// active combatant to the Table, with union-vision fallback out of combat.

import { isGM, isTableUser, getTableUserId, isTableOnline } from "./identity.mjs";
import { executeAsUser, setHandler } from "./sockets.mjs";
import { ensureTableObserver } from "./ownership.mjs";
import { sleep } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/** Time to wait between granting OBSERVER and broadcasting focus. */
const OWNERSHIP_PROPAGATION_DELAY_MS = 200;

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
  logger.info(`setVisionFocus(${tokenId ?? "null"})`);
  try {
    if (!tokenId) {
      (canvas?.tokens?.controlled ?? []).forEach((t) => t.release());
    } else {
      const tok = canvas?.tokens?.get(tokenId);
      if (!tok) {
        logger.warn(`setVisionFocus: token ${tokenId} not on this canvas.`);
        return;
      }
      // Token.control() returns falsy if the user lacks permission. Capture
      // the return so we can surface that case prominently.
      const ok = tok.control({ releaseOthers: true });
      if (ok === false) {
        logger.warn(
          `setVisionFocus: Token.control() denied for ${tokenId} ` +
            `(actor "${tok.actor?.name ?? "?"}"). Table user lacks OBSERVER ` +
            `on the underlying actor — should have been auto-granted by ` +
            `the GM-side broadcast.`,
        );
      }
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

  const c = combat ?? game.combats?.active;
  const tokenId = activeCombatantTokenId(c);

  // If we're about to ask the Table to focus on a token, make sure the
  // Table user has at least OBSERVER on the underlying actor — otherwise
  // Token.control() silently no-ops on their client (permission check
  // fails). PCs already get OWNER via ownership.syncAll(); this handles
  // NPC combatants on the fly.
  let grantedNow = false;
  if (tokenId) {
    const combatant = c?.combatant;
    const actor = combatant?.actor ?? combatant?.token?.actor;
    if (actor) {
      const tableId2 = tableId;
      const before = actor.ownership?.[tableId2];
      try {
        await ensureTableObserver(actor);
        const after = actor.ownership?.[tableId2];
        grantedNow = after !== before;
      } catch (err) {
        logger.debug("ensureTableObserver on combatant actor failed:", err);
      }
    }
  }

  // If we just bumped ownership, wait briefly so the update lands on the
  // Table client before the socket-driven Token.control() runs.
  if (grantedNow) await sleep(OWNERSHIP_PROPAGATION_DELAY_MS);

  logger.info(`broadcastFocus: tokenId=${tokenId ?? "null"} (release-all otherwise).`);
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
