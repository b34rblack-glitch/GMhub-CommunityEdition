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
      // Physical-mini: one grid square = a fixed real-world size on the TV.
      physical: "COMMUNITY_SCREEN.settings.fit-mode.physical",
    },
  });

  // ---- custom-scale -------------------------------------------------------
  // Physical-mini target: the real-world size ONE grid square should render
  // at on the Table display, in the unit chosen by `physical-target-unit`.
  // Only consulted when the fit mode is "physical".
  game.settings.register(MODULE_ID, "custom-scale", {
    name: "COMMUNITY_SCREEN.settings.custom-scale.name",
    hint: "COMMUNITY_SCREEN.settings.custom-scale.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1.0,
    // A grid square between 0.1 and 20 (inches or cm) covers 25mm/1" minis
    // through oversized cm grids. Must be > 0 (guarded again in computeFit).
    range: { min: 0.1, max: 20, step: 0.1 },
  });

  // ---- physical-target-unit ----------------------------------------------
  // Unit for the `custom-scale` physical target size (cm or inch).
  game.settings.register(MODULE_ID, "physical-target-unit", {
    name: "COMMUNITY_SCREEN.settings.physical-target-unit.name",
    hint: "COMMUNITY_SCREEN.settings.physical-target-unit.hint",
    scope: "world",
    config: true,
    type: String,
    default: "inch",
    choices: {
      inch: "COMMUNITY_SCREEN.settings.physical-target-unit.inch",
      cm: "COMMUNITY_SCREEN.settings.physical-target-unit.cm",
    },
  });

  // ---- display-diagonal-in ------------------------------------------------
  // The Table display's physical diagonal in inches (e.g. 55 for a 55" TV).
  // Together with the native resolution this derives pixels-per-inch. Default
  // 0 is intentionally invalid so physical mode warns until it's configured.
  game.settings.register(MODULE_ID, "display-diagonal-in", {
    name: "COMMUNITY_SCREEN.settings.display-diagonal-in.name",
    hint: "COMMUNITY_SCREEN.settings.display-diagonal-in.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0,
    range: { min: 0, max: 120, step: 0.5 },
  });

  // ---- display-res-width / display-res-height -----------------------------
  // The Table display's NATIVE resolution in device pixels. Sentinel 0 =
  // auto-detect at fit time on the Table client (screen dimensions × renderer
  // resolution) — NOT prefilled from the GM form, which would capture the GM
  // laptop's screen instead of the TV.
  game.settings.register(MODULE_ID, "display-res-width", {
    name: "COMMUNITY_SCREEN.settings.display-res-width.name",
    hint: "COMMUNITY_SCREEN.settings.display-res-width.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0,
  });
  game.settings.register(MODULE_ID, "display-res-height", {
    name: "COMMUNITY_SCREEN.settings.display-res-height.name",
    hint: "COMMUNITY_SCREEN.settings.display-res-height.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0,
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

  // ---- combat-hud-enabled -------------------------------------------------
  // Client-scoped: only the Table client wants the player-facing combat HUD
  // (current + next combatant + round). Default off so a baseline table sees
  // no extra overlay. Read at render time so the toggle takes effect live.
  game.settings.register(MODULE_ID, "combat-hud-enabled", {
    name: "COMMUNITY_SCREEN.settings.combat-hud-enabled.name",
    hint: "COMMUNITY_SCREEN.settings.combat-hud-enabled.hint",
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

  // ---- spotlight-enabled --------------------------------------------------
  // World-scoped: gates the GM-only "Spotlight token" / "Clear spotlight"
  // controls in the control palette. Default off so tables that never want to
  // override the automatic vision rules see no extra buttons.
  game.settings.register(MODULE_ID, "spotlight-enabled", {
    name: "COMMUNITY_SCREEN.settings.spotlight-enabled.name",
    hint: "COMMUNITY_SCREEN.settings.spotlight-enabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // ---- setup-complete -----------------------------------------------------
  // Hidden from the config UI (`config: false`). World-scoped boolean flag set
  // true once the first-run setup wizard has been completed OR explicitly
  // dismissed ("Don't show again"). Gates the wizard's one-time auto-open so it
  // never re-fires on its own; the palette "Run setup" button ignores it.
  game.settings.register(MODULE_ID, "setup-complete", {
    name: "COMMUNITY_SCREEN.settings.setup-complete.name",
    hint: "COMMUNITY_SCREEN.settings.setup-complete.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
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
