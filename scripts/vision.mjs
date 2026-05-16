// ============================================================================
// scripts/vision.mjs
// ----------------------------------------------------------------------------
// Combat-aware vision focus.
//
// Design rule: the Table's vision follows the COMBAT TRACKER's active
// combatant, NOT the GM's selection. GMs constantly select NPCs, traps,
// lights, walls and templates that the room shouldn't see through, so
// `controlToken` is deliberately not a trigger here.
//
// Flow:
//   GM combat hook (combatStart/Turn/Round/updateCombat)
//     → broadcastFocus(combat)
//       → ensureTableObserver(combatant.actor)  (so Token.control succeeds)
//       → 200ms settle so the ownership update reaches the Table
//       → executeAsUser("setVisionFocus", tableUserId, {tokenId})
//   Table receives setVisionFocus
//     → Token.control({releaseOthers:true}) on the named token
//     → canvas.perception.update(...) to refresh vision/lighting/sounds
//
// Out-of-combat: combatEnd / deleteCombat broadcast tokenId=null, which
// causes the Table to release all controlled tokens and fall back to
// Foundry's native union-vision over OBSERVER actors.
// ============================================================================

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
  // Prefer the hook-supplied combat over the global; the global may lag.
  const c = combat ?? game.combats?.active;
  if (!c?.started) return null;
  // v14 Combatant shape may expose tokenId directly or via the token doc.
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
      // Release-all → Foundry falls back to union of OBSERVER actors.
      (canvas?.tokens?.controlled ?? []).forEach((t) => t.release());
    } else {
      // Look up the token on this client's canvas.
      const tok = canvas?.tokens?.get(tokenId);
      if (!tok) {
        // The token might not have been placed on the Table's canvas yet
        // (mid-scene-switch race). Surface it so it's visible in dev tools.
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
    // Tell PIXI to recompute vision, lighting, and sound exposure.
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
  // No-op if there's no Table client online to receive it.
  if (!isTableOnline()) return;
  const tableId = getTableUserId();
  if (!tableId) return;

  // Prefer the hook-supplied combat over the global to avoid stale reads.
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
    // Try the combatant's actor directly, then via the token document.
    const actor = combatant?.actor ?? combatant?.token?.actor;
    if (actor) {
      const before = actor.ownership?.[tableId];
      try {
        await ensureTableObserver(actor);
        const after = actor.ownership?.[tableId];
        // Track whether we actually wrote anything so we only sleep when needed.
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
    // tokenId=null is the signal to release-all on the Table side.
    await executeAsUser("setVisionFocus", tableId, { tokenId: null });
  } catch {
    // executeAsUser already logs the failure; nothing more to do.
  }
}

/**
 * Register vision-related hooks on the GM client and the Table handler
 * on every client.
 *
 * @returns {void}
 */
export function init() {
  // Table-side handler registration (idempotent; safe on every client).
  setHandler("setVisionFocus", _setVisionFocus);

  // GM-side hooks only. controlToken is intentionally NOT a trigger —
  // the GM may select an NPC, trap, light, etc. without intending to change
  // what the Table sees. The combat tracker is the authoritative source.
  Hooks.once("ready", () => {
    if (!isGM()) return;

    // Every combat lifecycle event that changes the active combatant.
    Hooks.on("combatStart", (combat) => broadcastFocus(combat));
    Hooks.on("combatTurn", (combat) => broadcastFocus(combat));
    Hooks.on("combatRound", (combat) => broadcastFocus(combat));
    Hooks.on("updateCombat", (combat) => broadcastFocus(combat));
    // End-of-combat → release Table back to union vision.
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
