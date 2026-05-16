// ============================================================================
// scripts/settings.mjs
// ----------------------------------------------------------------------------
// Registers every `game.settings` entry the module owns.
//
// Scopes:
//   "world"  — stored on the server, same for every client (e.g. who is the
//              Table user, what fit mode to use, whether to dim the canvas
//              behind popups).
//   "client" — stored in the browser's localStorage, per-client (e.g.
//              whether THIS browser shows the active-turn highlight,
//              whether THIS browser is in play vs setup mode).
//
// `init()` MUST run from Foundry's `init` hook before any other feature
// module reads settings — `main.mjs` enforces this ordering.
//
// `get(key, fallback)` and `set(key, value)` are convenience wrappers that
// swallow the "setting not registered yet" error case (which happens if
// a getter runs before init).
// ============================================================================

import { MODULE_ID } from "./module.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Register every world-scoped and client-scoped setting used by the module.
 * Must be called from the `init` hook before any feature module reads settings.
 *
 * @returns {void}
 */
export function init() {
  // Debug breadcrumb — only visible when CONFIG.debug.modules includes us.
  logger.debug("Registering settings.");

  // ---- table-user-id ------------------------------------------------------
  // The user that drives the shared TV. Accepts either a user id or a user
  // name (resolved by identity.getTableUser).
  game.settings.register(MODULE_ID, "table-user-id", {
    name: "COMMUNITY_SCREEN.settings.table-user-id.name",
    hint: "COMMUNITY_SCREEN.settings.table-user-id.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  // ---- fit-mode -----------------------------------------------------------
  // Default scene fit mode when a scene has no per-scene override flag.
  game.settings.register(MODULE_ID, "fit-mode", {
    name: "COMMUNITY_SCREEN.settings.fit-mode.name",
    hint: "COMMUNITY_SCREEN.settings.fit-mode.hint",
    scope: "world",
    config: true,
    type: String,
    default: "contain",
    choices: {
      // Whole map visible, letterboxed if needed.
      contain: "COMMUNITY_SCREEN.settings.fit-mode.contain",
      // Map fills screen, edges cropped.
      cover: "COMMUNITY_SCREEN.settings.fit-mode.cover",
      // Fit to viewport width regardless of height.
      width: "COMMUNITY_SCREEN.settings.fit-mode.width",
      // Fit to viewport height regardless of width.
      height: "COMMUNITY_SCREEN.settings.fit-mode.height",
      // Pixel-for-pixel, no scaling.
      native: "COMMUNITY_SCREEN.settings.fit-mode.native",
    },
  });

  // ---- custom-scale -------------------------------------------------------
  // Reserved for physical-mini mode (v0.3 roadmap). Currently informational.
  game.settings.register(MODULE_ID, "custom-scale", {
    name: "COMMUNITY_SCREEN.settings.custom-scale.name",
    hint: "COMMUNITY_SCREEN.settings.custom-scale.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1.0,
    // Slider range constraint shown in the settings UI.
    range: { min: 0, max: 4, step: 0.05 },
  });

  // ---- highlight-enabled --------------------------------------------------
  // Client-scoped: only the Table client wants the ring drawn. Default off
  // for non-Table clients to avoid distracting other players.
  game.settings.register(MODULE_ID, "highlight-enabled", {
    name: "COMMUNITY_SCREEN.settings.highlight-enabled.name",
    hint: "COMMUNITY_SCREEN.settings.highlight-enabled.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  // ---- highlight-style ----------------------------------------------------
  // Visual variant for the active-turn highlight. All four styles are
  // rendered natively in PIXI v7; no external module dependencies.
  game.settings.register(MODULE_ID, "highlight-style", {
    name: "COMMUNITY_SCREEN.settings.highlight-style.name",
    hint: "COMMUNITY_SCREEN.settings.highlight-style.hint",
    scope: "world",
    config: true,
    type: String,
    default: "default",
    choices: {
      // Thin ring, few spokes, slow rotation.
      subtle: "COMMUNITY_SCREEN.settings.highlight-style.subtle",
      // Mid weight, 8 spokes (recommended).
      default: "COMMUNITY_SCREEN.settings.highlight-style.default",
      // Thick ring, fast rotation, big pulse.
      dramatic: "COMMUNITY_SCREEN.settings.highlight-style.dramatic",
      // Three rings + procedural glyphs + halo + BlurFilter glow.
      ornate: "COMMUNITY_SCREEN.settings.highlight-style.ornate",
    },
  });

  // ---- highlight-use-disposition -----------------------------------------
  // Off = always-yellow ring. On = color by token disposition
  // (friendly = yellow, hostile = red, neutral = cool gray).
  game.settings.register(MODULE_ID, "highlight-use-disposition", {
    name: "COMMUNITY_SCREEN.settings.highlight-use-disposition.name",
    hint: "COMMUNITY_SCREEN.settings.highlight-use-disposition.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // ---- table-mode ---------------------------------------------------------
  // Hidden from the config UI (`config: false`) — toggled programmatically
  // by the Ctrl+Shift+U keybinding via sockets._setTableMode. Persists per
  // Table browser so a reload preserves the play/setup state.
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

  // ---- suppress-table-chat -----------------------------------------------
  // Hides the chat input on the Table client so spectators can't type.
  game.settings.register(MODULE_ID, "suppress-table-chat", {
    name: "COMMUNITY_SCREEN.settings.suppress-table-chat.name",
    hint: "COMMUNITY_SCREEN.settings.suppress-table-chat.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // ---- auto-grant-ownership ----------------------------------------------
  // Master switch for the ownership.syncAll behavior. Default on.
  game.settings.register(MODULE_ID, "auto-grant-ownership", {
    name: "COMMUNITY_SCREEN.settings.auto-grant-ownership.name",
    hint: "COMMUNITY_SCREEN.settings.auto-grant-ownership.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // ---- popup-backdrop ----------------------------------------------------
  // Toggle the 60%-dark canvas overlay when popups are open on the Table.
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
 * Wraps `game.settings.get` in try/catch so callers don't need to guard
 * against "setting not registered yet" (which throws in Foundry).
 *
 * @param {string} key - Setting key.
 * @param {*} [fallback] - Returned if the setting throws.
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
 * Helper to write a setting. Returns the promise from `game.settings.set`
 * (which world-scoped settings need awaiting on for proper persistence).
 *
 * @param {string} key - Setting key.
 * @param {*} value - Value to write.
 * @returns {Promise<*>}
 */
export function set(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}
