// ============================================================================
// scripts/control-palette.mjs
// ----------------------------------------------------------------------------
// Small GM-facing ApplicationV2 window with quick actions.
//
// Three buttons:
//   Close All Pop-ups   — dispatch closeAllPopups socket to the Table
//   Refit Scene         — dispatch refitScene socket to the Table
//   Toggle Table Mode   — dispatch toggleTableMode socket to the Table
//
// Reached via a scene-control toolbar button (injected through the
// getSceneControlButtons hook), or via the console fallback:
//   game.modules.get("community-screen").api.openPalette()
//
// Built on ApplicationV2 + HandlebarsApplicationMixin (v14 idiom).
// Template lives in templates/control-palette.hbs.
// ============================================================================

import { MODULE_ID } from "./module.mjs";
import { isGM, getTableUserId, isTableOnline } from "./identity.mjs";
import { executeAsUser } from "./sockets.mjs";
import { fitSceneToTable } from "./scene-fit.mjs";
import { t } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * The singleton control palette instance. Kept around so re-opening just
 * re-renders rather than allocating a new window each time.
 *
 * @type {ControlPalette | null}
 */
let palette = null;

/**
 * GM control palette built on ApplicationV2 with HandlebarsApplicationMixin.
 * Renders templates/control-palette.hbs with a status indicator and three
 * action buttons.
 */
class ControlPalette extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  // AppV2's static options govern window chrome and behavior.
  static DEFAULT_OPTIONS = {
    id: "community-screen-control-palette",
    classes: ["community-screen", "community-screen-control-palette"],
    tag: "div",
    window: {
      title: "COMMUNITY_SCREEN.control-palette.title",
      icon: "fa-solid fa-tv",
      resizable: false,
    },
    position: { width: 320, height: "auto" },
    // `actions` maps data-action attributes in the template to handler methods.
    actions: {
      "close-all": ControlPalette._onCloseAll,
      "refit-scene": ControlPalette._onRefit,
      "toggle-table-mode": ControlPalette._onToggle,
    },
  };

  // AppV2 PARTS: each named part is a Handlebars partial rendered into a
  // matching <section data-application-part="main"> in the window.
  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/control-palette.hbs` },
  };

  /**
   * AppV2's data prep hook — returns the context passed to the template.
   * @override
   */
  async _prepareContext() {
    const tableId = getTableUserId();
    // Tri-state: no user, user-but-offline, user-and-online.
    const online = Boolean(tableId) && isTableOnline();
    return {
      hasTableUser: Boolean(tableId),
      online,
      // Pick the appropriate status string.
      statusText: !tableId
        ? t("control-palette.no-table-user")
        : online
          ? t("control-palette.table-online")
          : t("control-palette.table-offline"),
      // Pre-localize button labels so the template doesn't need i18n helpers.
      labels: {
        closeAll: t("buttons.close-all"),
        refitScene: t("buttons.refit-scene"),
        toggleTableMode: t("buttons.toggle-table-mode"),
      },
    };
  }

  /**
   * Action handler for the "Close All Pop-ups" button.
   *
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onCloseAll(_event) {
    const tableId = getTableUserId();
    if (!tableId) return;
    try {
      // Dispatch over socketlib to the Table; popups.mjs handles it.
      await executeAsUser("closeAllPopups", tableId);
      ui.notifications?.info(t("notifications.closed-all"));
    } catch (err) {
      logger.debug("closeAllPopups dispatch failed:", err);
    }
  }

  /**
   * Action handler for the "Refit Scene" button.
   *
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onRefit(_event) {
    const tableId = getTableUserId();
    if (!tableId) {
      // No Table user → just refit the GM's own canvas as a fallback.
      await fitSceneToTable();
      return;
    }
    try {
      // Trigger an explicit refit on the Table client. followScene is a
      // no-op when the Table is already viewing the current scene, so we
      // dispatch a dedicated refitScene handler instead.
      await executeAsUser("refitScene", tableId);
    } catch (err) {
      logger.debug("refit dispatch failed:", err);
    }
  }

  /**
   * Action handler for the "Toggle Table Mode" button.
   *
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onToggle(_event) {
    const tableId = getTableUserId();
    if (!tableId) return;
    try {
      await executeAsUser("toggleTableMode", tableId);
    } catch (err) {
      logger.debug("toggleTableMode dispatch failed:", err);
    }
  }
}

/**
 * Open (or re-render) the palette.
 *
 * @returns {void}
 */
export function open() {
  // Only GMs need this UI.
  if (!isGM()) return;
  // Lazy-instantiate the singleton on first open.
  if (!palette) palette = new ControlPalette();
  palette.render(true);
}

/**
 * Inject the palette button into Foundry's scene controls.
 *
 * Foundry v13/v14 changed the `getSceneControlButtons` hook payload from an
 * **array** of group objects to an **object map** keyed by group name. We
 * support both shapes defensively so the palette appears regardless of the
 * exact core version, and so an upstream change back doesn't break us.
 *
 * @param {Array<object> | Record<string, object>} controls
 * @returns {void}
 */
function injectSceneControl(controls) {
  if (!isGM()) return;
  if (!controls) return;

  // The tool definition we want to inject into the active group.
  const tool = {
    name: "community-screen-palette",
    title: t("control-palette.title"),
    icon: "fa-solid fa-tv",
    // `button: true` makes this a single-action click rather than a tool
    // that stays selected after clicking.
    button: true,
    visible: true,
    onClick: () => open(),
    onChange: () => open(),
  };

  // v14 shape: controls is an object map of group-name → group.
  if (!Array.isArray(controls) && typeof controls === "object") {
    // Prefer the token group (always present); fall back to whichever
    // group is first if the layout has been heavily customized.
    const group = controls.token ?? controls.tokens ?? Object.values(controls)[0];
    if (!group) return;
    // The group's `tools` might be an object map (newer) or an array (older).
    if (group.tools && !Array.isArray(group.tools) && typeof group.tools === "object") {
      // Dedupe by key.
      if (group.tools["community-screen-palette"]) return;
      group.tools["community-screen-palette"] = tool;
      return;
    }
    if (Array.isArray(group.tools)) {
      // Dedupe by name.
      if (group.tools.some((t) => t?.name === "community-screen-palette")) return;
      group.tools.push(tool);
      return;
    }
    return;
  }

  // Legacy v12-ish shape: controls is an array of groups with .tools arrays.
  if (Array.isArray(controls)) {
    const group = controls.find((g) => g?.name === "token") ?? controls[0];
    if (!group) return;
    if (!Array.isArray(group.tools)) return;
    if (group.tools.some((t) => t?.name === "community-screen-palette")) return;
    group.tools.push(tool);
  }
}

/**
 * Register hooks. Re-renders the palette when the Table user's online state changes.
 *
 * @returns {void}
 */
export function init() {
  // Scene-controls toolbar entry.
  Hooks.on("getSceneControlButtons", injectSceneControl);

  // Live-refresh status indicator when users connect/disconnect so the
  // online/offline dot stays accurate without the GM reopening it.
  Hooks.on("userConnected", () => {
    if (palette?.rendered) palette.render(false);
  });

  // Expose a console-callable opener so GMs can pop the palette even if
  // scene-control injection fails on some odd setup. From the dev tools:
  //   game.modules.get("community-screen").api.openPalette()
  Hooks.once("ready", () => {
    const mod = game.modules?.get?.("community-screen");
    if (mod) {
      mod.api = mod.api ?? {};
      mod.api.openPalette = () => open();
    }
  });
}
