// Community Screen — registers every game.settings entry the module owns.

import { MODULE_ID } from "./module.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Register every world-scoped and client-scoped setting used by the module.
 * Must be called from the `init` hook before any feature module reads settings.
 *
 * @returns {void}
 */
export function init() {
  logger.debug("Registering settings.");

  game.settings.register(MODULE_ID, "table-user-id", {
    name: "COMMUNITY_SCREEN.settings.table-user-id.name",
    hint: "COMMUNITY_SCREEN.settings.table-user-id.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "fit-mode", {
    name: "COMMUNITY_SCREEN.settings.fit-mode.name",
    hint: "COMMUNITY_SCREEN.settings.fit-mode.hint",
    scope: "world",
    config: true,
    type: String,
    default: "contain",
    choices: {
      contain: "COMMUNITY_SCREEN.settings.fit-mode.contain",
      cover: "COMMUNITY_SCREEN.settings.fit-mode.cover",
      width: "COMMUNITY_SCREEN.settings.fit-mode.width",
      height: "COMMUNITY_SCREEN.settings.fit-mode.height",
      native: "COMMUNITY_SCREEN.settings.fit-mode.native",
    },
  });

  game.settings.register(MODULE_ID, "custom-scale", {
    name: "COMMUNITY_SCREEN.settings.custom-scale.name",
    hint: "COMMUNITY_SCREEN.settings.custom-scale.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1.0,
    range: { min: 0, max: 4, step: 0.05 },
  });

  game.settings.register(MODULE_ID, "highlight-enabled", {
    name: "COMMUNITY_SCREEN.settings.highlight-enabled.name",
    hint: "COMMUNITY_SCREEN.settings.highlight-enabled.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "highlight-style", {
    name: "COMMUNITY_SCREEN.settings.highlight-style.name",
    hint: "COMMUNITY_SCREEN.settings.highlight-style.hint",
    scope: "world",
    config: true,
    type: String,
    default: "default",
    choices: {
      subtle: "COMMUNITY_SCREEN.settings.highlight-style.subtle",
      default: "COMMUNITY_SCREEN.settings.highlight-style.default",
      dramatic: "COMMUNITY_SCREEN.settings.highlight-style.dramatic",
      ornate: "COMMUNITY_SCREEN.settings.highlight-style.ornate",
    },
  });

  game.settings.register(MODULE_ID, "highlight-use-disposition", {
    name: "COMMUNITY_SCREEN.settings.highlight-use-disposition.name",
    hint: "COMMUNITY_SCREEN.settings.highlight-use-disposition.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "table-mode", {
    name: "COMMUNITY_SCREEN.settings.table-mode.name",
    hint: "COMMUNITY_SCREEN.settings.table-mode.hint",
    scope: "client",
    config: false,
    type: String,
    default: "play",
    choices: {
      play: "COMMUNITY_SCREEN.settings.table-mode.play",
      setup: "COMMUNITY_SCREEN.settings.table-mode.setup",
    },
  });

  game.settings.register(MODULE_ID, "suppress-table-chat", {
    name: "COMMUNITY_SCREEN.settings.suppress-table-chat.name",
    hint: "COMMUNITY_SCREEN.settings.suppress-table-chat.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "auto-grant-ownership", {
    name: "COMMUNITY_SCREEN.settings.auto-grant-ownership.name",
    hint: "COMMUNITY_SCREEN.settings.auto-grant-ownership.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "popup-backdrop", {
    name: "COMMUNITY_SCREEN.settings.popup-backdrop.name",
    hint: "COMMUNITY_SCREEN.settings.popup-backdrop.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

/**
 * Helper to read a setting with a typed default fallback.
 *
 * @param {string} key - Setting key.
 * @param {*} [fallback] - Returned if the setting throws (e.g. not yet registered).
 * @returns {*}
 */
export function get(key, fallback = undefined) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}

/**
 * Helper to write a setting.
 *
 * @param {string} key - Setting key.
 * @param {*} value - Value to write.
 * @returns {Promise<*>}
 */
export function set(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}
