// Community Screen — auto-grants OWNER on player-owned actors to the configured Table user.

import { isGM, getTableUserId, getTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { logger } from "./lib/logger.mjs";

const OWNERSHIP = () => globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? {};

/**
 * Grant the Table user the given ownership level on an actor, if not already.
 * Must be called from a GM client (server validates).
 *
 * @param {Actor} actor - Foundry Actor document.
 * @param {number} [level] - Defaults to OWNER.
 * @returns {Promise<void>}
 */
export async function grantTableOwnership(actor, level = OWNERSHIP().OWNER ?? 3) {
  const tableId = getTableUserId();
  if (!tableId) return;
  if (!actor) return;
  if (actor.ownership?.[tableId] === level) return;
  const ownership = foundry.utils.deepClone(actor.ownership ?? {});
  ownership[tableId] = level;
  try {
    await actor.update({ ownership });
    logger.debug(`Granted ownership ${level} on ${actor.name} to Table user.`);
  } catch (err) {
    logger.warn(`Failed to grant ownership on ${actor.name}:`, err);
  }
}

/**
 * Determine if an actor has "real" player ownership (any non-Table, non-GM
 * user holds OBSERVER or higher).
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
function hasRealPlayerOwner(actor) {
  const tableId = getTableUserId();
  const lvls = OWNERSHIP();
  const observer = lvls.OBSERVER ?? 2;
  for (const [uid, lvl] of Object.entries(actor.ownership ?? {})) {
    if (uid === "default") continue;
    if (uid === tableId) continue;
    const u = game.users?.get(uid);
    if (!u || u.isGM) continue;
    if (lvl >= observer) return true;
  }
  return false;
}

/**
 * Iterate every actor and ensure the Table user has OWNER on each that has
 * a non-Table player owner. Run on GM client at ready and on createActor.
 *
 * @returns {Promise<void>}
 */
export async function syncAll() {
  if (!isGM()) return;
  if (!getSetting("auto-grant-ownership", true)) return;
  const tableId = getTableUserId();
  if (!tableId) return;

  let touched = 0;
  for (const actor of game.actors ?? []) {
    if (hasRealPlayerOwner(actor)) {
      const before = actor.ownership?.[tableId];
      await grantTableOwnership(actor);
      if (before !== (OWNERSHIP().OWNER ?? 3)) touched++;
    }
  }
  if (touched > 0) logger.info(`Granted Table-user ownership on ${touched} actor(s).`);
}

/**
 * Warn the GM if the Table user has no actors with OBSERVER+ ownership —
 * they will see nothing on the TV.
 *
 * @returns {void}
 */
function warnIfNoVision() {
  if (!isGM()) return;
  const tableId = getTableUserId();
  if (!tableId) return;
  const observer = OWNERSHIP().OBSERVER ?? 2;
  const owner = OWNERSHIP().OWNER ?? 3;
  const any = (game.actors ?? []).some((a) => {
    const lvl = a.ownership?.[tableId] ?? a.ownership?.default ?? 0;
    return lvl >= observer || lvl >= owner;
  });
  if (!any) {
    const msg = game.i18n.localize("COMMUNITY_SCREEN.errors.no-observer-actors");
    try {
      ui.notifications?.warn(msg);
    } catch {
      // ignore
    }
    logger.warn(msg);
  }
}

/**
 * Register ownership-related hooks. Idempotent.
 *
 * @returns {void}
 */
export function init() {
  Hooks.once("ready", async () => {
    if (!isGM()) return;
    if (!getTableUser()) {
      logger.debug("No Table user configured — skipping ownership sync.");
      return;
    }
    await syncAll();
    warnIfNoVision();
  });

  Hooks.on("createActor", (actor) => {
    if (!isGM()) return;
    if (!getSetting("auto-grant-ownership", true)) return;
    if (hasRealPlayerOwner(actor)) grantTableOwnership(actor);
  });
}
