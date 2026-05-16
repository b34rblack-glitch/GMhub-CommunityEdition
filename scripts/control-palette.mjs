// Community Screen — small GM-facing ApplicationV2 with quick actions (close all, refit, toggle).

import { MODULE_ID } from "./module.mjs";
import { isGM, getTableUserId, isTableOnline } from "./identity.mjs";
import { executeAsUser } from "./sockets.mjs";
import { fitSceneToTable } from "./scene-fit.mjs";
import { t } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * The singleton control palette instance.
 * @type {ControlPalette | null}
 */
let palette = null;

/**
 * GM control palette built on ApplicationV2 with HandlebarsApplicationMixin.
 */
class ControlPalette extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
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
    actions: {
      "close-all": ControlPalette._onCloseAll,
      "refit-scene": ControlPalette._onRefit,
      "toggle-table-mode": ControlPalette._onToggle,
    },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/control-palette.hbs` },
  };

  /** @override */
  async _prepareContext() {
    const tableId = getTableUserId();
    const online = Boolean(tableId) && isTableOnline();
    return {
      hasTableUser: Boolean(tableId),
      online,
      statusText: !tableId
        ? t("control-palette.no-table-user")
        : online
          ? t("control-palette.table-online")
          : t("control-palette.table-offline"),
      labels: {
        closeAll: t("buttons.close-all"),
        refitScene: t("buttons.refit-scene"),
        toggleTableMode: t("buttons.toggle-table-mode"),
      },
    };
  }

  /**
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onCloseAll(_event) {
    const tableId = getTableUserId();
    if (!tableId) return;
    try {
      await executeAsUser("closeAllPopups", tableId);
      ui.notifications?.info(t("notifications.closed-all"));
    } catch (err) {
      logger.debug("closeAllPopups dispatch failed:", err);
    }
  }

  /**
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onRefit(_event) {
    const tableId = getTableUserId();
    if (!tableId) {
      // Locally refit on the GM client as a fallback.
      await fitSceneToTable();
      return;
    }
    try {
      // Push current scene; the followScene handler will trigger canvasReady → fit.
      const sceneId = canvas?.scene?.id;
      if (sceneId) await executeAsUser("followScene", tableId, { sceneId });
    } catch (err) {
      logger.debug("refit dispatch failed:", err);
    }
  }

  /**
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
  if (!isGM()) return;
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

  const tool = {
    name: "community-screen-palette",
    title: t("control-palette.title"),
    icon: "fa-solid fa-tv",
    button: true,
    visible: true,
    onClick: () => open(),
    onChange: () => open(),
  };

  // v14 shape: controls is an object map of group-name → group.
  if (!Array.isArray(controls) && typeof controls === "object") {
    const group = controls.token ?? controls.tokens ?? Object.values(controls)[0];
    if (!group) return;
    // Tools can be an object map or an array depending on version.
    if (group.tools && !Array.isArray(group.tools) && typeof group.tools === "object") {
      if (group.tools["community-screen-palette"]) return;
      group.tools["community-screen-palette"] = tool;
      return;
    }
    if (Array.isArray(group.tools)) {
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
  Hooks.on("getSceneControlButtons", injectSceneControl);

  // Live-refresh status indicator when users connect/disconnect.
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
