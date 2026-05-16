// ============================================================================
// scripts/ownership.mjs
// ----------------------------------------------------------------------------
// Auto-grants OWNER on player-owned actors to the configured Table user, and
// provides `ensureTableObserver()` for just-in-time grants during push and
// vision flows.
//
// Why this exists:
//   - For native union vision on the Table, the Table user needs OBSERVER on
//     every party actor.
//   - For the Table to drag tokens, the Table user needs OWNER on the
//     actor's token document (inherited from actor for linked tokens).
//   - For Token.control() to succeed on an NPC combatant during combat,
//     the Table user needs OBSERVER on that NPC's actor too.
//
// All writes happen on a GM client (server permission-check requires it).
// The Player-role Table client never writes ownership directly.
// ============================================================================

import { isGM, getTableUserId, getTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { logger } from "./lib/logger.mjs";

// Lazy accessor for Foundry's CONST.DOCUMENT_OWNERSHIP_LEVELS so module
// load order can't crash us; falls back to literal numeric values.
const OWNERSHIP = () => globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? {};

/**
 * Grant the Table user the given ownership level on an actor, if not already.
 * Must be called from a GM client (server validates).
 *
 * @param {Actor} actor - Foundry Actor document.
 * @param {number} [level] - Defaults to OWNER (3).
 * @returns {Promise<void>}
 */
export async function grantTableOwnership(actor, level = OWNERSHIP().OWNER ?? 3) {
  const tableId = getTableUserId();
  // No-op if Table user isn't configured or actor is missing.
  if (!tableId) return;
  if (!actor) return;
  // Skip the write if the Table user is already at the exact target level.
  if (actor.ownership?.[tableId] === level) return;
  // Deep clone so we don't mutate the document's internal state directly.
  const ownership = foundry.utils.deepClone(actor.ownership ?? {});
  ownership[tableId] = level;
  try {
    await actor.update({ ownership });
    logger.debug(`Granted ownership ${level} on ${actor.name} to Table user.`);
  } catch (err) {
    // Most likely cause: caller wasn't actually a GM (server rejected).
    logger.warn(`Failed to grant ownership on ${actor.name}:`, err);
  }
}

/**
 * Determine if an actor has "real" player ownership — i.e. any non-Table,
 * non-GM user holds OBSERVER or higher on it. This is how we decide
 * which actors are PCs (and thus deserve auto-OWNER for the Table).
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
function hasRealPlayerOwner(actor) {
  const tableId = getTableUserId();
  const lvls = OWNERSHIP();
  const observer = lvls.OBSERVER ?? 2;
  // Iterate every ownership entry on the actor.
  for (const [uid, lvl] of Object.entries(actor.ownership ?? {})) {
    // "default" is the fallback level applied to users not explicitly listed.
    if (uid === "default") continue;
    // The Table user's own ownership doesn't count as "real player owner".
    if (uid === tableId) continue;
    // Look up the user; skip if not found or if they're a GM.
    const u = game.users?.get(uid);
    if (!u || u.isGM) continue;
    // A non-Table non-GM user with OBSERVER+ → this is a PC.
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
  // Honor the master toggle in settings.
  if (!getSetting("auto-grant-ownership", true)) return;
  const tableId = getTableUserId();
  if (!tableId) return;

  // Count grants for a single summary log line at the end.
  let touched = 0;
  for (const actor of game.actors ?? []) {
    if (hasRealPlayerOwner(actor)) {
      // Snapshot the pre-grant level so we only count actual changes.
      const before = actor.ownership?.[tableId];
      await grantTableOwnership(actor);
      if (before !== (OWNERSHIP().OWNER ?? 3)) touched++;
    }
  }
  if (touched > 0) logger.info(`Granted Table-user ownership on ${touched} actor(s).`);
}

/**
 * Warn the GM if the Table user has no actors with OBSERVER+ ownership —
 * they will see nothing on the TV. Fires once at `ready`.
 *
 * @returns {void}
 */
function warnIfNoVision() {
  if (!isGM()) return;
  const tableId = getTableUserId();
  if (!tableId) return;
  const observer = OWNERSHIP().OBSERVER ?? 2;
  const owner = OWNERSHIP().OWNER ?? 3;
  // Check any actor at OBSERVER+ for the Table user (either explicit or via default).
  const any = (game.actors ?? []).some((a) => {
    const lvl = a.ownership?.[tableId] ?? a.ownership?.default ?? 0;
    return lvl >= observer || lvl >= owner;
  });
  // If none, surface a visible warning so the GM can fix it.
  if (!any) {
    const msg = game.i18n.localize("COMMUNITY_SCREEN.errors.no-observer-actors");
    try {
      ui.notifications?.warn(msg);
    } catch {
      // ui not ready in some edge cases; the logger.warn below still records it.
    }
    logger.warn(msg);
  }
}

/**
 * Just-in-time grant of OBSERVER (or higher) ownership to the Table user
 * on any document. Used by push-buttons (so the Table can render the doc
 * the GM is pushing) and by vision (so Token.control on an NPC combatant
 * doesn't silently fail).
 *
 * Idempotent: skipped if the Table user is already at or above `level`.
 * Must be called from a GM client.
 *
 * @param {Document} doc - Any document with `.ownership`. Pass an Actor
 *   when granting for vision/control; a JournalEntry/Item/etc for push.
 * @param {number} [level] - Defaults to OBSERVER (2).
 * @returns {Promise<void>}
 */
export async function ensureTableObserver(doc, level = OWNERSHIP().OBSERVER ?? 2) {
  if (!isGM()) return;
  // Defensive checks — `doc` can legitimately be null/undefined.
  if (!doc) return;
  // Some "documents" passed in (e.g. embedded entries) lack update.
  if (typeof doc.update !== "function") return;
  const tableId = getTableUserId();
  if (!tableId) return;

  // Compute the user's effective current level (specific wins over default).
  const current = doc.ownership?.[tableId] ?? doc.ownership?.default ?? 0;
  // Already at or above target — nothing to do.
  if (current >= level) return;

  // Apply the bump.
  const ownership = foundry.utils.deepClone(doc.ownership ?? {});
  ownership[tableId] = level;
  try {
    await doc.update({ ownership });
    logger.debug(
      `Granted ownership ${level} on ${doc.documentName} "${doc.name ?? doc.id}" to Table user.`,
    );
  } catch (err) {
    logger.warn(`Failed to grant ownership on ${doc.documentName} "${doc.name ?? doc.id}":`, err);
  }
}

/**
 * Register ownership-related hooks. Idempotent.
 *
 * @returns {void}
 */
export function init() {
  // At ready: GM walks every actor once and brings Table OBSERVER+OWNER
  // up to standard. Plus warns if vision will be empty.
  Hooks.once("ready", async () => {
    if (!isGM()) return;
    if (!getTableUser()) {
      logger.debug("No Table user configured — skipping ownership sync.");
      return;
    }
    await syncAll();
    warnIfNoVision();
  });

  // Newly-created actors get the same treatment automatically.
  Hooks.on("createActor", (actor) => {
    if (!isGM()) return;
    if (!getSetting("auto-grant-ownership", true)) return;
    if (hasRealPlayerOwner(actor)) grantTableOwnership(actor);
  });
}
