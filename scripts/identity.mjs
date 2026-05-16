// Community Screen — per-client identity helpers: isTableUser, getTableUserId, isGM.

import { MODULE_ID } from "./module.mjs";

/**
 * Resolve the configured `table-user-id` setting value to a User document.
 * The value may be either:
 *   - a Foundry user id (the 16-character random string), or
 *   - a user name (e.g. "Table") — handy because that's what GMs see in the
 *     player list.
 *
 * @returns {User | undefined}
 */
export function getTableUser() {
  let ident;
  try {
    ident = game.settings.get(MODULE_ID, "table-user-id") ?? "";
  } catch {
    return undefined;
  }
  if (!ident) return undefined;
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
  return getTableUser()?.id ?? "";
}

/**
 * @returns {string} The raw (unresolved) setting value. Useful for
 *   diagnostics — distinguishes "setting empty" from "setting set but
 *   doesn't match any user".
 */
export function getTableUserSetting() {
  try {
    return game.settings.get(MODULE_ID, "table-user-id") ?? "";
  } catch {
    return "";
  }
}

/**
 * @returns {boolean} True if this client is logged in as the configured Table user.
 */
export function isTableUser() {
  const id = getTableUserId();
  return Boolean(id) && game.user?.id === id;
}

/**
 * @returns {boolean} True if this client is a GM (full or assistant).
 */
export function isGM() {
  return Boolean(game.user?.isGM);
}

/**
 * @returns {boolean} True if a Table user is configured and currently connected.
 */
export function isTableOnline() {
  return Boolean(getTableUser()?.active);
}
