// ============================================================================
// scripts/keybindings.mjs
// ----------------------------------------------------------------------------
// GM-only keybinding registration.
//
// Two hotkeys:
//   Ctrl+Shift+U → toggle the Table client between play / setup mode
//                  (paired UI-hide + canvas-lock toggle)
//   Ctrl+Shift+P → close every popup on the Table
//
// Both are gated with `restricted: true` so non-GM users can't even see
// them in the keybinding editor. They route through socketlib's
// executeAsUser to the configured Table user.
//
// `diagnoseDispatch()` distinguishes three failure modes so the warning
// message points the GM at the actual cause (no user configured / config
// doesn't match anyone / user offline) rather than a generic "didn't work".
// ============================================================================

import { MODULE_ID } from "./module.mjs";
import { getTableUserId, getTableUserSetting, isGM, isTableOnline } from "./identity.mjs";
import { executeAsUser } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Diagnose why a GM keybinding can't dispatch to the Table client.
 * Returns null when everything is fine, otherwise a localized warning
 * string to show via `ui.notifications.warn`.
 *
 * @returns {string | null}
 */
function diagnoseDispatch() {
  // Raw setting (whatever the GM actually typed in).
  const raw = getTableUserSetting();
  // Case 1: setting empty → "No Table user is configured".
  if (!raw) {
    return game.i18n.localize("COMMUNITY_SCREEN.errors.no-table-user");
  }
  // Case 2: setting set but doesn't resolve to any user (typo or stale).
  const id = getTableUserId();
  if (!id) {
    return game.i18n.format("COMMUNITY_SCREEN.errors.unknown-table-user", { value: raw });
  }
  // Case 3: user resolves but isn't connected right now.
  if (!isTableOnline()) {
    return game.i18n.localize("COMMUNITY_SCREEN.warnings.no-table-user-online");
  }
  // All good — caller can dispatch.
  return null;
}

/**
 * Register every keybinding. Must be called from the `init` hook
 * (Foundry's keybinding system requires registration during init).
 *
 * @returns {void}
 */
export function init() {
  // Toggle Table Mode — pairs UI-hidden + canvas-lock on the Table.
  game.keybindings.register(MODULE_ID, "toggle-table-mode", {
    name: "COMMUNITY_SCREEN.keybindings.toggle-table-mode.name",
    hint: "COMMUNITY_SCREEN.keybindings.toggle-table-mode.hint",
    // Default chord: Ctrl+Shift+U (user-editable).
    editable: [{ key: "KeyU", modifiers: ["Control", "Shift"] }],
    // restricted=true hides the binding from non-GM users entirely.
    restricted: true,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    onDown: () => {
      // Non-GM users shouldn't get here (restricted), but defensive check.
      if (!isGM()) return false;
      // Show the most specific applicable warning, then bail.
      const problem = diagnoseDispatch();
      if (problem) {
        ui.notifications?.warn(problem);
        return true;
      }
      // Fire the toggle on the Table — fire-and-forget; we don't need the result.
      executeAsUser("toggleTableMode", getTableUserId()).catch((err) =>
        logger.debug("toggleTableMode dispatch failed:", err),
      );
      // Return true so the keypress is consumed (no other binding sees it).
      return true;
    },
  });

  // Close All Pop-ups — instant table-screen reset.
  game.keybindings.register(MODULE_ID, "close-all-popups", {
    name: "COMMUNITY_SCREEN.keybindings.close-all-popups.name",
    hint: "COMMUNITY_SCREEN.keybindings.close-all-popups.hint",
    // Default chord: Ctrl+Shift+P.
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
      // Fire the close-all on the Table.
      executeAsUser("closeAllPopups", getTableUserId()).catch((err) =>
        logger.debug("closeAllPopups dispatch failed:", err),
      );
      return true;
    },
  });
}
