// Community Screen — GM-only keybinding registration (toggle table mode, close all pop-ups).

import { MODULE_ID } from "./module.mjs";
import { getTableUserId, getTableUserSetting, isGM, isTableOnline } from "./identity.mjs";
import { executeAsUser } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Diagnose why a GM keybinding can't dispatch to the Table client.
 * Returns null when everything is fine, otherwise a localized warning
 * string to show via ui.notifications.warn.
 *
 * @returns {string | null}
 */
function diagnoseDispatch() {
  const raw = getTableUserSetting();
  if (!raw) {
    return game.i18n.localize("COMMUNITY_SCREEN.errors.no-table-user");
  }
  const id = getTableUserId();
  if (!id) {
    // Setting is non-empty but doesn't match any user by id or name.
    return game.i18n.format("COMMUNITY_SCREEN.errors.unknown-table-user", { value: raw });
  }
  if (!isTableOnline()) {
    return game.i18n.localize("COMMUNITY_SCREEN.warnings.no-table-user-online");
  }
  return null;
}

/**
 * Register every keybinding. Must be called from the `init` hook.
 *
 * @returns {void}
 */
export function init() {
  game.keybindings.register(MODULE_ID, "toggle-table-mode", {
    name: "COMMUNITY_SCREEN.keybindings.toggle-table-mode.name",
    hint: "COMMUNITY_SCREEN.keybindings.toggle-table-mode.hint",
    editable: [{ key: "KeyU", modifiers: ["Control", "Shift"] }],
    restricted: true,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    onDown: () => {
      if (!isGM()) return false;
      const problem = diagnoseDispatch();
      if (problem) {
        ui.notifications?.warn(problem);
        return true;
      }
      executeAsUser("toggleTableMode", getTableUserId()).catch((err) =>
        logger.debug("toggleTableMode dispatch failed:", err),
      );
      return true;
    },
  });

  game.keybindings.register(MODULE_ID, "close-all-popups", {
    name: "COMMUNITY_SCREEN.keybindings.close-all-popups.name",
    hint: "COMMUNITY_SCREEN.keybindings.close-all-popups.hint",
    editable: [{ key: "KeyP", modifiers: ["Control", "Shift"] }],
    restricted: true,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    onDown: () => {
      if (!isGM()) return false;
      const problem = diagnoseDispatch();
      if (problem) {
        ui.notifications?.warn(problem);
        return true;
      }
      executeAsUser("closeAllPopups", getTableUserId()).catch((err) =>
        logger.debug("closeAllPopups dispatch failed:", err),
      );
      return true;
    },
  });
}
