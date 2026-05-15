// Community Screen — GM-only keybinding registration (toggle table mode, close all pop-ups).

import { MODULE_ID } from "./module.mjs";
import { getTableUserId, isGM, isTableOnline } from "./identity.mjs";
import { executeAsUser } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

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
      const tableId = getTableUserId();
      if (!tableId || !isTableOnline()) {
        ui.notifications?.warn(
          game.i18n.localize("COMMUNITY_SCREEN.warnings.no-table-user-online"),
        );
        return true;
      }
      executeAsUser("toggleTableMode", tableId).catch((err) =>
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
      const tableId = getTableUserId();
      if (!tableId || !isTableOnline()) {
        ui.notifications?.warn(
          game.i18n.localize("COMMUNITY_SCREEN.warnings.no-table-user-online"),
        );
        return true;
      }
      executeAsUser("closeAllPopups", tableId).catch((err) =>
        logger.debug("closeAllPopups dispatch failed:", err),
      );
      return true;
    },
  });
}
