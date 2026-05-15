// Community Screen — per-client identity helpers: isTableUser, getTableUserId, isGM.

import { MODULE_ID } from "./module.mjs";

/**
 * @returns {string} The configured Table user id, or "" if unset.
 */
export function getTableUserId() {
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
 * @returns {User | undefined} The Foundry User document for the Table user, if any.
 */
export function getTableUser() {
  const id = getTableUserId();
  if (!id) return undefined;
  return game.users?.get(id);
}

/**
 * @returns {boolean} True if a Table user is configured and currently connected.
 */
export function isTableOnline() {
  return Boolean(getTableUser()?.active);
}
