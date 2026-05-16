// ============================================================================
// scripts/identity.mjs
// ----------------------------------------------------------------------------
// Per-client identity helpers.
//
// The whole module branches on "is this the Table user, is this the GM"
// dozens of times. These helpers centralize that check so we only have one
// place to fix if Foundry's user model ever shifts.
//
// The `table-user-id` setting historically required a literal user id, but
// `getTableUser()` is now tolerant: it tries `game.users.get(value)` first
// (id lookup) and falls back to `game.users.getName(value)` so a GM can
// type the user's name (e.g. "Table") and have it just work.
// ============================================================================

import { MODULE_ID } from "./module.mjs";

/**
 * Resolve the configured `table-user-id` setting value to a User document.
 * The value may be either:
 *   - a Foundry user id (the 16-character random string), or
 *   - a user name (e.g. "Table") — handy because that's what GMs see in the
 *     player list.
 *
 * @returns {User | undefined} The resolved User, or undefined if unset / not found.
 */
export function getTableUser() {
  // Holds the raw setting value (either id or name).
  let ident;
  try {
    // Read the setting; default to empty string so the ?? below is safe.
    ident = game.settings.get(MODULE_ID, "table-user-id") ?? "";
  } catch {
    // Setting not registered yet (called during init); bail out cleanly.
    return undefined;
  }
  // Empty string means the setting is unconfigured.
  if (!ident) return undefined;
  // Try id lookup first; fall back to name lookup so either form works.
  return game.users?.get(ident) ?? game.users?.getName?.(ident);
}

/**
 * @returns {string} The resolved Table user's id, or "" if none.
 *
 * Always returns an actual user id — even when the user configured the
 * Table user by name. Call sites that pass this to `executeAsUser` get a
 * usable id either way.
 */
export function getTableUserId() {
  // Resolve to a User first, then pull its id — handles the name-input case.
  return getTableUser()?.id ?? "";
}

/**
 * @returns {string} The raw (unresolved) setting value. Useful for
 *   diagnostics — distinguishes "setting empty" from "setting set but
 *   doesn't match any user".
 */
export function getTableUserSetting() {
  try {
    // Same read as getTableUser but without the name/id resolution step.
    return game.settings.get(MODULE_ID, "table-user-id") ?? "";
  } catch {
    return "";
  }
}

/**
 * @returns {boolean} True if this client is logged in as the configured Table user.
 */
export function isTableUser() {
  // Resolve the configured Table user, then compare against this client's user.
  const id = getTableUserId();
  return Boolean(id) && game.user?.id === id;
}

/**
 * @returns {boolean} True if this client is a GM (full or assistant). Mirrors
 *   Foundry's own role check.
 */
export function isGM() {
  return Boolean(game.user?.isGM);
}

/**
 * @returns {boolean} True if a Table user is configured AND currently connected
 *   (a browser tab is open and joined to the world).
 */
export function isTableOnline() {
  // Foundry sets User#active to true when the user has an active websocket.
  return Boolean(getTableUser()?.active);
}
