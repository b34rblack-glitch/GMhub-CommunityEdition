// ============================================================================
// scripts/ui-hiding.mjs
// ----------------------------------------------------------------------------
// Body-class toggle that hides Foundry's chrome on the Table client.
//
// The actual CSS lives in `styles/community-screen.css`, which selects
// `body.community-screen-hidden #sidebar`, `... #hotbar`, etc. and applies
// `display: none !important`. This file owns the JS-side toggle and the
// follow-up renderer resize + canvas re-pan so the map stays centered when
// chrome appears or disappears.
//
// On the Table client at `ready`, we read the persisted `table-mode`
// client setting and apply the corresponding state (play = hidden,
// setup = visible).
// ============================================================================

import { BODY_CLASS_HIDDEN } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Apply or remove the body class that hides Foundry's chrome.
 *
 * After toggling, request a renderer resize and re-pan so the canvas
 * stays centered on the scene's view position — without this, the canvas
 * sits with the same pixel dimensions and the map ends up off-center
 * when the chrome takes/releases viewport space.
 *
 * @param {boolean} hidden - True to hide chrome; false to reveal.
 * @returns {void}
 */
export function setUiHidden(hidden) {
  // Single source of truth: the body class. CSS does the rest.
  document.body.classList.toggle(BODY_CLASS_HIDDEN, Boolean(hidden));
  try {
    // Tell PIXI the viewport size changed so it re-projects correctly.
    canvas?.app?.renderer?.resize?.(window.innerWidth, window.innerHeight);
    // Restore the saved view position so the map stays where it was.
    const view = canvas?.scene?._viewPosition;
    if (view && typeof canvas.pan === "function") canvas.pan(view);
  } catch (err) {
    // Non-fatal — the body class change still took effect.
    logger.warn("Failed to re-fit canvas after UI toggle:", err);
  }
}

/**
 * @returns {boolean} True if the chrome-hidden body class is currently applied.
 */
export function isUiHidden() {
  return document.body.classList.contains(BODY_CLASS_HIDDEN);
}

/**
 * Apply the UI hiding state corresponding to the saved `table-mode` setting
 * on the Table client. Called from `ready` on the Table client.
 *
 * @returns {void}
 */
export function applyFromSettings() {
  // No-op on every client except the Table — only Table hides chrome.
  if (!isTableUser()) return;
  // The setting persists across reloads so the Table comes back in the
  // same mode the GM left it in.
  const mode = getSetting("table-mode", "play");
  setUiHidden(mode === "play");
}

/**
 * Register `ready`-time hook to apply UI hiding on the Table client.
 *
 * @returns {void}
 */
export function init() {
  // We use `ready` (not `init`) because we need both `game.user` and
  // the canvas DOM to be available.
  Hooks.once("ready", () => {
    applyFromSettings();
  });
}
